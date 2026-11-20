# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

An Alexa Smart Home skill that controls Home Assistant on a home server ("Newcombe", 10.0.0.69). It has three TypeScript packages, each with its own `package.json` and no shared workspace:

- `cdk/`: CDK app (IoT, Lambda and Cognito stacks), AWS account 690063008832, us-east-1
- `cdk/lambda/`: Lambda source (`ha-alexa-skill-handler`), Node.js 22 on arm64
- `bridge/`: MQTT bridge container that runs on Newcombe

The request path is Alexa → Lambda → IoT Core topic `home/commands/alexa` → bridge (persistent **outbound** mTLS connection, so no inbound ports are open) → `POST {HA_URL}/api/services/{domain}/{service}`.

## Commands

The repo has no tests and no linter. `tsc` is the only check.

```bash
# Type-check / build each package
cd cdk/lambda && npm install && npm run build
cd bridge && npm install && npm run build      # npm run dev = ts-node src/bridge.ts
cd cdk && npm install && npm run build

# Synth/diff (certArn context is required by bin/app.ts, or synth throws)
cd cdk
CERT=arn:aws:iot:us-east-1:690063008832:cert/c5e2fbc1e686a8069cc8ff4ee81920e1b3fe639754d606fccbe42e36823daf58
npx cdk synth HaAlexaLambdaStack --context certArn=$CERT --exclusively --output /tmp/cdk-out-<name>
npx cdk diff  HaAlexaLambdaStack --context certArn=$CERT --exclusively --output /tmp/cdk-out-<name>

# Deploy Lambda only (the normal case)
npx cdk deploy HaAlexaLambdaStack --context certArn=$CERT --exclusively --require-approval never --output /tmp/cdk-out-<name>
```

- Always use `--exclusively` when deploying the Lambda. The IoT stack attaches a live X.509 cert that was created outside CDK on purpose, and Cognito holds the account-linking config.
- Use a unique `--output` dir to avoid `cdk.out` lock conflicts.
- CDK bundling runs `npm install && npm run build && npm prune --omit=dev` inside `cdk/lambda`. It falls back to Docker only if local bundling fails.
- The bridge isn't deployed from this repo. It's built and run by the compose stack on Newcombe (`/home/casey/stacks/smarthome`, service `mqtt-bridge`). See `bridge/README.md` for how to run it.

## Architecture Notes

**Device list is runtime config, not code.** The SSM parameter `/ha-alexa-skill/entity-catalog` (Advanced tier, JSON array) is read fresh on every Discovery directive. To add a device, run `aws ssm put-parameter --overwrite` and then say "Alexa, discover devices". No redeploy is needed. `lambda-stack.ts` creates this parameter with a placeholder `light.example` value. CloudFormation leaves the live value alone only as long as that resource's definition stays the same. **Changing the `EntityCatalog` construct will overwrite the real catalog.** Back it up first.

**The cookie carries discovery data to controller handling.** `discovery.ts` turns catalog entries into Alexa endpoints and stores metadata in each endpoint's `cookie`. Alexa sends the cookie back with every directive, and `controllers.ts` uses it:
- Non-cover devices use `endpointId = HA entityId`, with cookie `{haType}`.
- Covers use `endpointId = slugify(friendlyName)`, with cookie `{haType, haEntityId, coverType}`. Several catalog entries can share one HA entity under different spoken names.
- Changing how endpoint IDs or cookies are built changes the devices Alexa knows about. It needs a re-discovery and can orphan existing Alexa devices and routines.

**Controller → HA mapping** is in `controllers.ts`. `TYPE_TO_DOMAIN` maps the catalog `type` to an HA domain, and each Alexa namespace becomes an HA service call. After publishing, the handler must return a valid Alexa `Response` with the `correlationToken` and context properties. Past bugs came from malformed responses.

**Covers (Tesla trunk/front trunk) use `ModeController`, instance `Cover.Position`**, with modes `Position.Open`/`Position.Closed`. PowerController and LockController were tried and dropped, as the git history shows. The working phrase is "Alexa, set the black car's trunk to open". In user-facing text, write "front trunk", not "frunk", because Alexa reads it aloud more clearly. The catalog enum value `FRUNK` stays as it is.

**The bridge is intentionally generic.** It forwards `{domain, service, entity_id, service_data?}` (the `HACommand` interface in `cdk/lambda/src/iot.ts`) to HA without knowing anything about devices. Put device-specific logic in the Lambda, not the bridge. Changing this payload shape means updating both `iot.ts` and `bridge/src/bridge.ts`, and rebuilding the container on Newcombe.

**Existing hardcoded values:** the account ID, region, Alexa skill ID (`eventSourceToken` in `lambda-stack.ts`) and Cognito domain are all hardcoded in source. Don't rename existing physical names (`ha-alexa-skill-handler`, the stack IDs, the SSM path). Renaming forces replacement and breaks the Alexa console endpoint configuration.

**Secrets:** IoT certs (`*.pem.crt`, `*.pem.key`) and `bridge.env` (which holds the HA long-lived token) live only on Newcombe and are git-ignored. Compiled `*.js` and `*.d.ts` files are git-ignored too.
