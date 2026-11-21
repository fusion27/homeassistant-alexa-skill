import * as dotenv from 'dotenv';
import { ManifestSnapshot } from './contract';
import { HaRegistryClient } from './ha/registry';
import { WsHaRegistryClient } from './ha/ws-registry-client';
import { WsHaChangeWatcher } from './ha/change-watcher';
import { SyncScheduler } from './sync-scheduler';
import { BuildResult, buildManifest } from './manifest/builder';
import { IotManifestPublisher, ManifestPublisher } from './iot/publisher';

dotenv.config();

function requireEnv(name: string): string {
  const value: string | undefined = process.env[name];
  if (value === undefined || value === '') {
    console.error(JSON.stringify({ msg: 'missing required env var', name }));
    process.exit(1);
  }
  return value;
}

const HA_URL: string = process.env.HA_URL ?? 'http://localhost:8123';
const HA_TOKEN: string = requireEnv('HA_TOKEN');
const IOT_ENDPOINT: string = requireEnv('IOT_ENDPOINT');
const CERT_PATH: string = process.env.CERT_PATH ?? '/certs';
const MANIFEST_TOPIC: string = process.env.MANIFEST_TOPIC ?? 'home/manifest/alexa';
const EXPOSE_LABEL_ID: string = process.env.EXPOSE_LABEL_ID ?? 'alexa';
const DEBOUNCE_MS = 5_000;
const SAFETY_INTERVAL_MS: number = 6 * 60 * 60 * 1000;

function websocketUrl(httpUrl: string): string {
  return `${httpUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/api/websocket`;
}

/** Builds the manifest from HA and publishes it as one full snapshot. */
export class ManifestSync {
  constructor(
    private readonly registry: HaRegistryClient,
    private readonly publisher: ManifestPublisher,
    private readonly labelId: string,
  ) {}

  async run(): Promise<void> {
    const result: BuildResult = buildManifest(await this.registry.fetchSnapshot(), this.labelId);
    const snapshot: ManifestSnapshot = { version: 1, generatedAt: new Date().toISOString(), entries: result.entries };
    await this.publisher.publish(snapshot);
    console.log(JSON.stringify({
      msg: 'manifest published',
      entries: result.entries.map((e) => `${e.entityId} as "${e.friendlyName}"`),
      skipped: result.skipped,
    }));
  }
}

async function main(): Promise<void> {
  const wsUrl: string = websocketUrl(HA_URL);
  const sync = new ManifestSync(
    new WsHaRegistryClient(wsUrl, HA_TOKEN),
    new IotManifestPublisher({ endpoint: IOT_ENDPOINT, certPath: CERT_PATH, clientId: 'newcombe-manifest-sync', topic: MANIFEST_TOPIC }),
    EXPOSE_LABEL_ID,
  );
  // Fail fast on startup so Docker restarts the container; later failures are logged and retried.
  await sync.run();

  const scheduler = new SyncScheduler(() => sync.run(), DEBOUNCE_MS, SAFETY_INTERVAL_MS);
  scheduler.start();
  new WsHaChangeWatcher(wsUrl, HA_TOKEN).start((reason: string) => scheduler.request(reason));
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ msg: 'fatal', error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
