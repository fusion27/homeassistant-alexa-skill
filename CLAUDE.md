# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

An Alexa Smart Home skill that controls Home Assistant on a home server ("Newcombe", 10.0.0.69). It has four TypeScript packages, each with its own `package.json` and no shared workspace:

- `cdk/`: CDK app (IoT, Lambda, Cognito and Manifest stacks), AWS account 690063008832, us-east-1
- `cdk/lambda/`: Lambda source (`ha-alexa-skill-handler`), Node.js 22 on arm64
- `bridge/`: MQTT bridge container that runs on Newcombe
- `manifest-sync/`: container on Newcombe that builds the Alexa exposure manifest from HA and publishes it to IoT Core

The request path is Alexa → Lambda → IoT Core topic `home/commands/alexa` → bridge (persistent **outbound** mTLS connection, so no inbound ports are open) → `POST {HA_URL}/api/services/{domain}/{service}`.

## Commands

The repo has no tests and no linter. `tsc` is the only check.

```bash
# Type-check / build each package
cd cdk/lambda && npm install && npm run build
cd bridge && npm install && npm run build      # npm run dev = ts-node src/bridge.ts
cd cdk && npm install && npm run build
cd manifest-sync && npm install && npm run build

# Synth/diff (bin/app.ts reads /ha-alexa-skill/config from SSM, so AWS credentials are required)
cd cdk
npx cdk synth HaAlexaLambdaStack --exclusively --output /tmp/cdk-out-<name>
npx cdk diff  HaAlexaLambdaStack --exclusively --output /tmp/cdk-out-<name>

# Deploy Lambda only (the normal case)
npx cdk deploy HaAlexaLambdaStack --exclusively --require-approval never --output /tmp/cdk-out-<name>

# Change config: edit a local JSON copy (keep it out of git), then
npx ts-node scripts/put-config.ts <config.json>          # validate only
npx ts-node scripts/put-config.ts <config.json> --yes    # write
```

- **Config** lives in one SecureString Standard parameter, `/ha-alexa-skill/config` (account, IoT cert ARN and topics, skill ID, account-link vendor ID, Cognito domain prefix). `bin/app.ts` decrypts it before `new App()` and passes only non-sensitive fields to stacks. The only values left in source are its name and region (`lib/config.ts`). After the synth bundling step, `npm prune --omit=dev` strips dev deps from `cdk/lambda`, so run `npm install` there before `tsc`.
- Deploy `HaAlexaManifestStack` before `HaAlexaLambdaStack`, since the Lambda stack imports the Exposure table.

- Always use `--exclusively` when deploying the Lambda. The IoT stack attaches a live X.509 cert that was created outside CDK on purpose, and Cognito holds the account-linking config.
- Use a unique `--output` dir to avoid `cdk.out` lock conflicts.
- CDK bundling runs `npm install && npm run build && npm prune --omit=dev` inside `cdk/lambda`. It falls back to Docker only if local bundling fails.
- The bridge isn't deployed from this repo. It's built and run by the compose stack on Newcombe (`/home/casey/stacks/smarthome`, service `mqtt-bridge`). See `bridge/README.md` for how to run it.

## Architecture Notes

**The device list is the Alexa exposure manifest, built from HA.** An HA entity is exposed if and only if it's enabled and carries the label `alexa`, created in HA as "Alexa". Its first entity alias is the spoken name, falling back to HA's friendly name. Supported domains are in `DOMAIN_MAPPERS` (`manifest-sync/src/manifest/builder.ts`). Flow: `manifest-sync` (Newcombe) reads HA's registries over the WebSocket API and publishes a **full snapshot** to IoT topic `home/manifest/alexa`. An IoT Rule invokes `manifest-ingest`, which reconciles the DynamoDB **Exposure** table (`HaAlexaManifestStack`, `pk=ENDPOINT`, `sk=<endpointId>`) to match the snapshot: it puts new or changed entries and deletes missing ones. Re-publishing the same snapshot is a no-op, so an empty snapshot (no labeled entities) empties the table. The snapshot contract is `cdk/lambda/src/manifest/schema.ts`, copied as types into `manifest-sync/src/contract.ts`. Change both together. manifest-sync publishes at startup, 5 s after any `entity_registry_updated`/`device_registry_updated`/`label_registry_updated` event (bursts are coalesced), after reconnecting to HA, and every 6 h as a safety net. Labeling, unlabeling, renaming or (un)pairing in HA needs no restart. For now Alexa still needs "discover devices" to see the change.

**Endpoint IDs are HA entity-registry ids**, not `entity_id`s, so renames in Z2M or HA don't orphan Alexa devices. Discovery `Query`s the table, and controllers `GetItem` by `endpointId` to get the current `entity_id`. No cookie is used. An unknown `endpointId` returns `NO_SUCH_ENDPOINT`. That includes devices discovered before the DynamoDB cutover. **Alexa never removes a device just because it's missing from a Discover.Response.** Devices removed from the table stay in the Alexa app and answer "not responding" until a `DeleteReport` is sent or someone deletes them by hand. Discovery only adds or updates devices. The old SSM `/ha-alexa-skill/entity-catalog` (Advanced tier) was deleted on 2026-11-20.

**Controller → HA mapping** is in `controllers.ts`. `TYPE_TO_DOMAIN` maps the catalog `type` to an HA domain, and each Alexa namespace becomes an HA service call. After publishing, the handler must return a valid Alexa `Response` with the `correlationToken` and context properties. Past bugs came from malformed responses.

**Covers (Tesla trunk/front trunk) use `ModeController`, instance `Cover.Position`**, with modes `Position.Open`/`Position.Closed`. PowerController and LockController were tried and dropped, as the git history shows. The working phrase is "Alexa, set the black car's trunk to open". In user-facing text, write "front trunk", not "frunk", because Alexa reads it aloud more clearly. The catalog enum value `FRUNK` stays as it is.

**manifest-sync** uses IoT client ID `newcombe-manifest-sync` and its own IoT policy (`HaAlexaManifestStack`). Never reuse `newcombe-ha-bridge`, because IoT Core would disconnect the bridge. It reads `config/bridge.env` and `config/certs` on Newcombe, and is built and run by the `smarthome` compose stack like the bridge.

**The bridge is intentionally generic.** It forwards `{domain, service, entity_id, service_data?}` (the `HACommand` interface in `cdk/lambda/src/iot.ts`) to HA without knowing anything about devices. Put device-specific logic in the Lambda, not the bridge. Changing this payload shape means updating both `iot.ts` and `bridge/src/bridge.ts`, and rebuilding the container on Newcombe.

**Don't rename existing physical names** (`ha-alexa-skill-handler`, `manifest-ingest`, the stack IDs, the `/ha-alexa-skill/config` path). Renaming forces replacement and breaks the Alexa console endpoint configuration.

**Secrets:** IoT certs (`*.pem.crt`, `*.pem.key`) and `bridge.env` (which holds the HA long-lived token) live only on Newcombe and are git-ignored. Compiled `*.js` and `*.d.ts` files are git-ignored too.
