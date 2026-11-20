import * as iot from 'aws-iot-device-sdk-v2';
import { ManifestSnapshot } from '../contract';

export interface ManifestPublisher {
  publish(snapshot: ManifestSnapshot): Promise<void>;
}

export interface IotConnectionOptions {
  endpoint: string;
  certPath: string;
  /** Must differ from the bridge's client ID, or IoT Core disconnects the bridge. */
  clientId: string;
  topic: string;
}

/** Publishes snapshots to IoT Core over the existing mTLS cert. */
export class IotManifestPublisher implements ManifestPublisher {
  private readonly client: iot.mqtt5.Mqtt5Client;
  private readonly connected: Promise<void>;

  constructor(private readonly options: IotConnectionOptions) {
    const builder = iot.iot.AwsIotMqtt5ClientConfigBuilder.newDirectMqttBuilderWithMtlsFromPath(
      options.endpoint,
      `${options.certPath}/certificate.pem.crt`,
      `${options.certPath}/private.pem.key`,
    )
      .withCertificateAuthorityFromPath(undefined, `${options.certPath}/AmazonRootCA1.pem`)
      .withConnectProperties({ clientId: options.clientId, keepAliveIntervalSeconds: 30 });
    this.client = new iot.mqtt5.Mqtt5Client(builder.build());

    this.connected = new Promise<void>((resolve) => {
      this.client.on('connectionSuccess', () => {
        console.log(JSON.stringify({ msg: 'iot connected', clientId: options.clientId }));
        resolve();
      });
    });
    this.client.on('connectionFailure', (event: iot.mqtt5.ConnectionFailureEvent) => {
      console.error(JSON.stringify({ msg: 'iot connection failed', error: String(event.error) }));
    });
    this.client.on('disconnection', (event: iot.mqtt5.DisconnectionEvent) => {
      console.warn(JSON.stringify({ msg: 'iot disconnected', error: String(event.error) }));
    });
    this.client.start();
  }

  async publish(snapshot: ManifestSnapshot): Promise<void> {
    await this.connected;
    await this.client.publish({
      topicName: this.options.topic,
      qos: iot.mqtt5.QoS.AtLeastOnce,
      payload: JSON.stringify(snapshot),
    });
  }
}
