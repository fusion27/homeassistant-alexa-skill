# MQTT Bridge

A TypeScript Node.js application that runs as a Docker container on Newcombe. It is the critical link between AWS and Home Assistant.

## Why This Exists

Home Assistant runs inside the home network with no public internet exposure. AWS Lambda can't reach it directly. Instead of opening inbound firewall ports (a security risk), the bridge makes a persistent *outbound* TLS connection to AWS IoT Core and waits for messages. When a command arrives, it calls Home Assistant's local REST API. **No inbound ports are ever opened.**

## What MQTT Is

MQTT is a lightweight publish/subscribe messaging protocol. Think of it like a chat channel: publishers send messages to a "topic" (a channel name like `home/commands/alexa`), and subscribers receive them. AWS IoT Core is the broker — the server in the middle.

The bridge subscribes to `home/commands/#` on startup. When Alexa triggers Lambda, Lambda publishes a command JSON to `home/commands/alexa`. IoT Core immediately delivers it to the bridge via the persistent connection. **The bridge never polls — it just listens.**

## TLS and Certificates

The connection to IoT Core uses mutual TLS — both sides prove their identity with X.509 certificates. AWS issued a certificate specifically for Newcombe's bridge during CDK setup. Three files are required:

| File | What it is |
|---|---|
| `certificate.pem.crt` | Newcombe's identity certificate, issued by AWS IoT |
| `private.pem.key` | Newcombe's private key — never leaves Newcombe |
| `AmazonRootCA1.pem` | AWS root CA — used to verify IoT Core's identity |

These are mounted into the container at `/certs` (read-only). They are **never** baked into the Docker image and **never** committed to git.

## Where It Runs

| | |
|---|---|
| Host | Newcombe (10.0.0.69) |
| Compose file | `/home/casey/stacks/smarthome/docker-compose.yml` |
| Service name | `mqtt-bridge` |
| Certs | `/home/casey/stacks/smarthome/config/certs/` |
| Env file | `/home/casey/stacks/smarthome/config/bridge.env` |

## Environment Variables (`bridge.env`)

```
IOT_ENDPOINT=xxxxxxxxxxxxx-ats.iot.us-east-1.amazonaws.com
CERT_PATH=/certs
HA_URL=http://homeassistant:8123
HA_TOKEN=<long-lived Home Assistant access token>
TOPIC_PREFIX=home/commands
```

`IOT_ENDPOINT` is emitted as a CloudFormation output by `HaAlexaIotStack` (`IotEndpointOutput`).

## `src/bridge.ts` — How It Works

1. Loads env vars and validates required ones are set
2. Builds an MQTT5 client using the AWS IoT Device SDK v2 with mutual TLS from the cert files
3. Connects to IoT Core with client ID `newcombe-ha-bridge` and a 30-second keepalive
4. Subscribes to `home/commands/#`
5. On `messageReceived`: parses the JSON payload `{domain, service, entity_id, service_data?}` and calls `POST http://homeassistant:8123/api/services/{domain}/{service}` with the HA Bearer token
6. Logs every received message and every HA API call/result

**The bridge is intentionally generic** — it has no knowledge of specific device types. Lambda decides what `domain` and `service` to use; the bridge just forwards the JSON to HA.

## Dockerfile

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build
VOLUME ["/certs"]
CMD ["node", "dist/bridge.js"]
```

Certs are declared as a volume and mounted at runtime — never baked into the image.

## Operations

**View logs:**
```bash
docker logs mqtt-bridge --tail 50 -f
# or from the compose directory:
docker compose logs -f mqtt-bridge
```

**Rebuild and restart after source changes:**
```bash
cd /home/casey/stacks/smarthome
docker compose build mqtt-bridge
docker compose up -d mqtt-bridge
docker compose logs -f mqtt-bridge
```

**Check connection status:**
```bash
docker compose ps mqtt-bridge
```

Expected log lines on healthy startup:
```
[Bridge] Starting HA Alexa MQTT bridge...
[IoT] Connected to AWS IoT Core
[Bridge] Subscribed to home/commands/#
[Bridge] Waiting for commands...
```

**Example command log (switch on):**
```
[IoT] Message on home/commands/alexa: {"domain":"switch","service":"turn_on","entity_id":"switch.back_yard_floods"}
[HA] POST http://homeassistant:8123/api/services/switch/turn_on { entity_id: 'switch.back_yard_floods' }
[HA] Success: switch.turn_on on switch.back_yard_floods
```
