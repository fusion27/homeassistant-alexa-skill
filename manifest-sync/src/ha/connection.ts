import WebSocket from 'ws';

interface HaMessage {
  id?: number;
  type: string;
  success?: boolean;
  result?: unknown;
  error?: { code: string; message: string };
  event?: unknown;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export type EventHandler = (event: unknown) => void;

/** One authenticated Home Assistant WebSocket connection with request/response correlation. */
export class HaConnection {
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private readonly subscriptions = new Map<number, EventHandler>();
  private readonly closeHandlers: (() => void)[] = [];

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (data: WebSocket.RawData) => this.onMessage(data));
    socket.on('close', () => this.onClose());
    // A socket error is always followed by 'close'; listening here keeps it from crashing the process.
    socket.on('error', () => undefined);
  }

  static open(url: string, token: string): Promise<HaConnection> {
    return new Promise<HaConnection>((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.once('error', (err: Error) => reject(err));
      socket.on('message', function onAuth(data: WebSocket.RawData): void {
        const message = JSON.parse(data.toString()) as { type: string };
        if (message.type === 'auth_required') {
          socket.send(JSON.stringify({ type: 'auth', access_token: token }));
        } else if (message.type === 'auth_ok') {
          socket.off('message', onAuth);
          resolve(new HaConnection(socket));
        } else if (message.type === 'auth_invalid') {
          socket.close();
          reject(new Error('HA rejected the access token'));
        }
      });
    });
  }

  call<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
    const id: number = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value: unknown) => resolve(value as T), reject });
      this.socket.send(JSON.stringify({ id, type, ...payload }));
    });
  }

  /** Subscribes to one HA event type. Events arrive tagged with the subscribe call's id. */
  async subscribeEvents(eventType: string, handler: EventHandler): Promise<void> {
    const id: number = this.nextId;
    this.subscriptions.set(id, handler);
    try {
      await this.call<null>('subscribe_events', { event_type: eventType });
    } catch (err: unknown) {
      this.subscriptions.delete(id);
      throw err;
    }
  }

  onClosed(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  close(): void {
    this.socket.close();
  }

  private onMessage(data: WebSocket.RawData): void {
    const message = JSON.parse(data.toString()) as HaMessage;
    if (message.id === undefined) return;
    if (message.type === 'event') {
      this.subscriptions.get(message.id)?.(message.event);
      return;
    }
    if (message.type !== 'result') return;
    const call: PendingCall | undefined = this.pending.get(message.id);
    if (call === undefined) return;
    this.pending.delete(message.id);
    if (message.success === true) call.resolve(message.result);
    else call.reject(new Error(`HA ${message.error?.code ?? 'error'}: ${message.error?.message ?? 'unknown'}`));
  }

  private onClose(): void {
    const err = new Error('HA WebSocket closed');
    for (const call of this.pending.values()) call.reject(err);
    this.pending.clear();
    this.subscriptions.clear();
    for (const handler of this.closeHandlers) handler();
  }
}
