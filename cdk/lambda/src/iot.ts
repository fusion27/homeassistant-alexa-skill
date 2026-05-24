import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';

const iotClient = new IoTDataPlaneClient({
  endpoint: `https://${process.env.IOT_ENDPOINT}`,
  region: 'us-east-1',
});

export interface HACommand {
  domain: string;
  service: string;
  entity_id: string;
  service_data?: Record<string, unknown>;
}

export async function publishCommand(command: HACommand): Promise<void> {
  const topic = `${process.env.IOT_TOPIC_PREFIX}/alexa`;
  console.log(`[IoT] Publishing to ${topic}:`, command);
  await iotClient.send(new PublishCommand({
    topic,
    qos: 1,
    payload: Buffer.from(JSON.stringify(command)),
  }));
}
