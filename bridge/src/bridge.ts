import * as iot from 'aws-iot-device-sdk-v2';
import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

const HA_URL = process.env.HA_URL || 'http://localhost:8123';
const HA_TOKEN = process.env.HA_TOKEN!;
const IOT_ENDPOINT = process.env.IOT_ENDPOINT!;
const CERT_PATH = process.env.CERT_PATH || '/certs';
const TOPIC_PREFIX = process.env.TOPIC_PREFIX || 'home/commands';

if (!HA_TOKEN || !IOT_ENDPOINT) {
  console.error('Missing required env vars: HA_TOKEN, IOT_ENDPOINT');
  process.exit(1);
}

interface HACommand {
  domain: string;
  service: string;
  entity_id: string;
  service_data?: Record<string, unknown>;
}

async function callHA(command: HACommand): Promise<void> {
  const url = `${HA_URL}/api/services/${command.domain}/${command.service}`;
  const payload = {
    entity_id: command.entity_id,
    ...command.service_data
  };
  console.log(`[HA] POST ${url}`, payload);
  await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${HA_TOKEN}` }
  });
  console.log(`[HA] Success: ${command.domain}.${command.service} on ${command.entity_id}`);
}

function buildDevice(): iot.mqtt5.Mqtt5Client {
  const builder = iot.iot.AwsIotMqtt5ClientConfigBuilder.newDirectMqttBuilderWithMtlsFromPath(
    IOT_ENDPOINT,
    `${CERT_PATH}/certificate.pem.crt`,
    `${CERT_PATH}/private.pem.key`
  )
    .withCertificateAuthorityFromPath(undefined, `${CERT_PATH}/AmazonRootCA1.pem`)
    .withConnectProperties({ clientId: 'newcombe-ha-bridge', keepAliveIntervalSeconds: 30 });

  return new iot.mqtt5.Mqtt5Client(builder.build());
}

async function main(): Promise<void> {
  console.log('[Bridge] Starting HA Alexa MQTT bridge...');
  const client = buildDevice();

  client.on('connectionSuccess', () => {
    console.log('[IoT] Connected to AWS IoT Core');
  });

  client.on('connectionFailure', (event) => {
    console.error('[IoT] Connection failed:', event.error);
  });

  client.on('disconnection', (event) => {
    console.warn('[IoT] Disconnected:', event.error?.error_name);
  });

  client.on('messageReceived', async (event) => {
    const topic = event.message.topicName;
    const raw = event.message.payload
      ? Buffer.from(event.message.payload as ArrayBuffer).toString('utf8')
      : '{}';

    console.log(`[IoT] Message on ${topic}:`, raw);

    try {
      const command: HACommand = JSON.parse(raw);
      await callHA(command);
    } catch (err) {
      console.error('[Bridge] Error processing message:', err);
    }
  });

  await client.start();

  await client.subscribe({
    subscriptions: [{ topicFilter: `${TOPIC_PREFIX}/#`, qos: iot.mqtt5.QoS.AtLeastOnce }]
  });

  console.log(`[Bridge] Subscribed to ${TOPIC_PREFIX}/#`);
  console.log('[Bridge] Waiting for commands...');
}

main().catch((err) => {
  console.error('[Bridge] Fatal error:', err);
  process.exit(1);
});
