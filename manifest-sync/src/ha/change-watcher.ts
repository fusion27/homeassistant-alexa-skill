import { HaConnection } from './connection';

/** Tells the caller that HA's registries may have changed. */
export interface HaChangeSource {
  start(onChange: (reason: string) => void): void;
}

/** Registry events that can change the manifest: pairing/removal, rename, alias and label edits. */
const REGISTRY_EVENTS: readonly string[] = [
  'entity_registry_updated',
  'device_registry_updated',
  'label_registry_updated',
];

/**
 * Holds a long-lived WebSocket subscription to HA's registry events and reconnects
 * when HA restarts. A reconnect also signals a change, since events may have been missed.
 */
export class WsHaChangeWatcher implements HaChangeSource {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly reconnectDelayMs: number = 10_000,
  ) {}

  start(onChange: (reason: string) => void): void {
    void this.connect(onChange, false);
  }

  private async connect(onChange: (reason: string) => void, isReconnect: boolean): Promise<void> {
    // One reconnect per attempt, whether it fails while subscribing or the socket closes later.
    let reconnectScheduled = false;
    const reconnectOnce = (): void => {
      if (reconnectScheduled) return;
      reconnectScheduled = true;
      this.scheduleReconnect(onChange);
    };
    let connection: HaConnection | undefined;
    try {
      connection = await HaConnection.open(this.url, this.token);
      connection.onClosed(() => {
        console.warn(JSON.stringify({ msg: 'ha websocket closed, reconnecting', delayMs: this.reconnectDelayMs }));
        reconnectOnce();
      });
      for (const eventType of REGISTRY_EVENTS) {
        await connection.subscribeEvents(eventType, () => onChange(eventType));
      }
      console.log(JSON.stringify({ msg: 'watching ha registry events', events: REGISTRY_EVENTS }));
      if (isReconnect) onChange('ha reconnected');
    } catch (err: unknown) {
      console.error(JSON.stringify({ msg: 'ha watch failed', error: err instanceof Error ? err.message : String(err) }));
      connection?.close();
      reconnectOnce();
    }
  }

  private scheduleReconnect(onChange: (reason: string) => void): void {
    setTimeout(() => void this.connect(onChange, true), this.reconnectDelayMs);
  }
}
