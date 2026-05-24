# Lambda — Alexa Smart Home Skill Backend

This Lambda function is the backend for the Alexa Smart Home skill. Alexa invokes it with a JSON "directive" for every voice command. The Lambda routes the directive, builds a Home Assistant command, publishes it to IoT Core, and returns a properly formatted Alexa response.

## Source Files

### `index.ts` — Entry point

The `handler` function. Logs the full incoming directive and routes by namespace:

| Namespace | Handler |
|---|---|
| `Alexa.Discovery` | `discovery.ts` |
| `Alexa.PowerController` | `controllers.ts` |
| `Alexa.BrightnessController` | `controllers.ts` |
| `Alexa.ColorController` | `controllers.ts` |
| `Alexa.ThermostatController` | `controllers.ts` |
| `Alexa.ModeController` | `controllers.ts` |

Also exports `buildErrorResponse` — builds a standard Alexa `ErrorResponse` envelope used across all handlers.

### `discovery.ts` — Device discovery

Handles `Alexa.Discovery` directives (triggered by "Alexa, discover devices").

Reads the SSM entity catalog at runtime and maps each entity to an Alexa endpoint:
- **Switches/lights** get `PowerController` (and optionally `BrightnessController`, `ColorController`)
- **Covers** get `ModeController` with `Cover.Position` instance and display category `OTHER`

The endpoint **cookie** is the mechanism that carries entity metadata (HA entity ID, device type, cover subtype) from discovery through to command handling. Alexa stores the cookie and sends it back with every directive for that endpoint.

Cover endpoints use a slugified friendly name as their endpoint ID (e.g. `black-car-trunk`) rather than the HA entity ID, because multiple friendly names can map to the same HA entity.

### `controllers.ts` — Command handling

Handles all controller directives. For each incoming directive:

1. Extracts `namespace`, `name`, `endpointId`, and the endpoint `cookie` (which carries `haType`, `haEntityId`, `coverType` from discovery)
2. Maps `haType` → HA domain via `TYPE_TO_DOMAIN`
3. Builds the HA command (`domain`, `service`, `entity_id`, optional `service_data`)
4. Publishes via `iot.ts`
5. Returns an Alexa `Response` with the appropriate context properties

**Alexa directive → HA command mapping:**

| Alexa namespace | Directive | Device type | HA domain | HA service |
|---|---|---|---|---|
| PowerController | TurnOn | SWITCH | switch | turn_on |
| PowerController | TurnOff | SWITCH | switch | turn_off |
| PowerController | TurnOn | LIGHT | light | turn_on |
| PowerController | TurnOff | LIGHT | light | turn_off |
| BrightnessController | SetBrightness | LIGHT | light | turn_on (brightness_pct) |
| ColorController | SetColor | LIGHT | light | turn_on (hs_color) |
| ModeController | SetMode (Position.Open) | COVER | cover | open_cover |
| ModeController | SetMode (Position.Closed) | COVER | cover | close_cover |

### `iot.ts` — IoT Core publisher

Publishes the HA command JSON to the IoT Core MQTT topic `home/commands/alexa` using the AWS SDK IoT Data Plane client. QoS 1 (at least once delivery).

The topic prefix is configurable via the `IOT_TOPIC_PREFIX` environment variable (set to `home/commands` by CDK).

## SSM Entity Catalog Schema

Each entry in `/ha-alexa-skill/entity-catalog`:

```json
{ "entityId": "switch.back_yard_floods", "friendlyName": "Back Yard Floods",
  "type": "SWITCH", "capabilities": ["PowerController"] }
```

```json
{ "entityId": "cover.hmmm_qt_trunk", "friendlyName": "black car trunk",
  "type": "COVER", "coverType": "TRUNK", "capabilities": ["PowerController"] }
```

Supported `type` values: `SWITCH`, `LIGHT`, `THERMOSTAT`, `SCENE_TRIGGER`, `COVER`

Supported `capabilities`: `PowerController`, `BrightnessController`, `ColorController`

Cover entries require `coverType`: `TRUNK` or `FRUNK`. Multiple catalog entries can share the same `entityId` to give a device multiple Alexa-visible names.

## Voice Command Phrasing

Covers use `ModeController` — the correct Alexa phrase is:
- **"Alexa, set the black car's trunk to open"**
- **"Alexa, set the black car's trunk to closed"**

"Open/close the trunk" routes to a different Alexa interface and won't work.

## Build

```bash
npm install && npm run build
```

Output goes to `dist/`. CDK bundles this into the Lambda deployment package.
