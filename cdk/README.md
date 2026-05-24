# CDK — AWS Infrastructure

This directory contains the AWS CDK app that provisions all cloud infrastructure and the Lambda function source.

## Solution Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AWS Cloud (us-east-1)                        │
│                                                                     │
│  ┌──────────────┐    ┌─────────────────────┐    ┌───────────────┐  │
│  │   Cognito    │    │   Lambda            │    │   IoT Core    │  │
│  │  User Pool   │    │ ha-alexa-skill-     │    │  MQTT Broker  │  │
│  │              │◄───│ handler             │───►│               │  │
│  │ Account link │    │                     │    │ home/commands │  │
│  │ OAuth flow   │    │ • Routes directives │    │ /alexa topic  │  │
│  └──────────────┘    │ • Reads SSM catalog │    └───────┬───────┘  │
│                      │ • Publishes to IoT  │            │          │
│  ┌──────────────┐    └──────────▲──────────┘            │          │
│  │     SSM      │               │                       │          │
│  │ entity-      │    ┌──────────┴──────────┐            │          │
│  │ catalog      │    │    Alexa Cloud      │            │          │
│  └──────────────┘    │  Smart Home Skill   │            │          │
└──────────────────────┴─────────────────────┴────────────┼──────────┘
                                                           │
                                  persistent outbound TLS  │
                                  (no inbound ports open)  │
                                                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Home Network (Newcombe 10.0.0.69)                 │
│                                                                     │
│   ┌───────────────────────────┐       ┌─────────────────────────┐  │
│   │   mqtt-bridge (Docker)    │       │ Home Assistant (Docker) │  │
│   │                           │──────►│                         │  │
│   │ Subscribes to IoT topic   │  REST │ Controls Z-Wave, Tesla, │  │
│   │ Forwards to HA REST API   │  API  │ smart plugs, etc.       │  │
│   └───────────────────────────┘       └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Stacks

### `HaAlexaIotStack` (`lib/iot-stack.ts`)

Provisions AWS IoT Core for the Newcombe bridge.

**What IoT Core is:** A managed MQTT message broker. MQTT is a lightweight publish/subscribe protocol — publishers send messages to a named "topic", subscribers receive them. IoT Core keeps the persistent connection to the bridge alive and routes messages through it.

This stack creates:
- A **Thing** — IoT Core's term for a registered device (here: the Newcombe bridge)
- A **Policy** — allows the bridge to connect as client `newcombe-ha-bridge`, subscribe to `home/commands/#`, and receive messages on those topics
- Attaches the pre-provisioned X.509 certificate to both the Thing and the Policy

The certificate itself is created outside CDK (via `aws iot create-keys-and-certificate`) and passed in via `--context certArn`. This is intentional — CDK should never rotate live certs.

### `HaAlexaLambdaStack` (`lib/lambda-stack.ts`)

Provisions the Lambda function that handles Alexa Smart Home directives.

**What a directive is:** The JSON payload Alexa sends to Lambda when a voice command is recognized. For example, "Alexa, turn on the back yard floods" produces a `PowerController/TurnOn` directive with the endpoint ID and cookie baked in from discovery.

This stack creates:
- The **Lambda function** (`ha-alexa-skill-handler`) — Node.js 22, arm64 (Graviton)
- An **IAM role** with permission to publish to IoT Core and read the SSM catalog
- An **Alexa Smart Home trigger** permission — allows `alexa-connectedhome.amazon.com` to invoke the function (scoped to the skill ID)
- An **SSM StringParameter** at `/ha-alexa-skill/entity-catalog` — read at runtime by the Lambda during discovery; updating it requires no redeploy

### `HaAlexaCognitoStack` (`lib/cognito-stack.ts`)

Provisions a Cognito User Pool for Alexa account linking OAuth.

**Why account linking exists:** Alexa requires the person enabling the skill to prove they're authorized before routing any commands to the Lambda. It does this via an OAuth2 authorization code flow against Cognito. Once linked, Alexa includes a Bearer token with every directive.

The User Pool is configured with:
- Email sign-in, self-signup disabled (accounts must be created manually)
- An app client scoped to `openid profile` with auth code grant
- Callback URLs for all three Alexa regional endpoints (`pitangui`, `layla`, `alexa.amazon.co.jp`)
- A hosted domain at `ha-alexa-skill-690063008832.auth.us-east-1.amazoncognito.com`

The Authorization and Token endpoint URLs are emitted as CloudFormation outputs — paste them into the Alexa Developer Console under Account Linking.

## Source Files

```
bin/app.ts          CDK app entry point — instantiates all three stacks
lib/iot-stack.ts    IoT Core Thing, certificate attachment, policy
lib/lambda-stack.ts Lambda function, IAM role, Alexa trigger, SSM param
lib/cognito-stack.ts Cognito User Pool, app client, hosted domain
lambda/src/         Lambda TypeScript source (see lambda/README.md)
```

## Deploy

**Lambda only** (most common — no cert rotation needed):
```bash
cd lambda && npm install && npm run build
cd ..
npx cdk deploy HaAlexaLambdaStack \
  --context certArn=arn:aws:iot:us-east-1:690063008832:cert/c5e2fbc1e686a8069cc8ff4ee81920e1b3fe639754d606fccbe42e36823daf58 \
  --exclusively \
  --require-approval never \
  --output /tmp/cdk-out-<descriptive-name>
```

`--exclusively` skips the IoT and Cognito stacks — the certs are already provisioned and should not be touched. `--output` avoids `cdk.out` lock conflicts if a previous deploy is still running.

**All stacks** (initial setup only):
```bash
npx cdk deploy --all \
  --context certArn=<cert-arn> \
  --require-approval never \
  --output /tmp/cdk-out-initial
```

## Adding New Devices

No redeploy needed. Update the SSM catalog and trigger re-discovery:

```bash
aws ssm put-parameter \
  --name /ha-alexa-skill/entity-catalog \
  --value "$(cat /tmp/new-catalog.json)" \
  --type String --tier Advanced --overwrite --region us-east-1
```

Then say **"Alexa, discover devices"**. The Lambda reads the catalog fresh on every Discovery directive.

> **Advanced tier is required** — the catalog exceeds the 4 KB standard tier limit once it has more than ~15 entries.
