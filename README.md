# Alexa → Home Assistant Skill

Voice-controls Home Assistant devices via an Alexa Smart Home skill backed by AWS Lambda and MQTT.

## How It Works

```
Alexa voice command
  → Alexa cloud
    → Lambda ha-alexa-skill-handler (us-east-1)
      → AWS IoT Core (MQTT broker)
        → mqtt-bridge Docker container on Newcombe (10.0.0.69)
          → Home Assistant REST API (localhost:8123)
            → Z-Wave / smart plug / Tesla Fleet API device
```

**Key design principle:** Newcombe's home network never accepts inbound internet traffic. The bridge makes a persistent *outbound* TLS connection to IoT Core and waits for messages. No ports are opened on the firewall.

## What's Controlled

- **Switches** — Z-Wave and smart plugs (Back Yard Floods, Craftroom, Office lights, etc.)
- **Tesla covers** — trunk and front trunk on both cars via Tesla Fleet API in HA

## Repo Structure

```
cdk/        AWS infrastructure (CDK TypeScript) + Lambda source
bridge/     MQTT bridge Docker container — runs on Newcombe
```

See [`cdk/README.md`](cdk/README.md) for infrastructure details and deploy instructions.
See [`bridge/README.md`](bridge/README.md) for bridge setup and operation.

## Quick Reference

**Deploy Lambda after a code change:**
```bash
cd cdk/lambda && npm install && npm run build
cd ..
npx cdk deploy HaAlexaLambdaStack \
  --context certArn=arn:aws:iot:us-east-1:690063008832:cert/c5e2fbc1e686a8069cc8ff4ee81920e1b3fe639754d606fccbe42e36823daf58 \
  --exclusively \
  --require-approval never \
  --output /tmp/cdk-out-<descriptive-name>
```

**Add a new device (no redeploy needed):**
```bash
# Edit catalog, then push:
aws ssm put-parameter \
  --name /ha-alexa-skill/entity-catalog \
  --value "$(cat /tmp/new-catalog.json)" \
  --type String --tier Advanced --overwrite --region us-east-1

# Then tell Alexa:
"Alexa, discover devices"
```
