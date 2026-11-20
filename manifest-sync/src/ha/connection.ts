import WebSocket from 'ws';

interface HaResultMessage {
  id: number;
  type: 'result';
  success: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

/** One authenticated Home Assistant WebSocket connection with request/response correlation. */
export class HaConnection {
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (data: WebSocket.RawData) => this.onMessage(data));
    socket.on('close', () => this.failAll(new Error('HA WebSocket closed')));
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

  close(): void {
    this.socket.close();
  }

  private onMessage(data: WebSocket.RawData): void {
    const message = JSON.parse(data.toString()) as Partial<HaResultMessage>;
    if (message.type !== 'result' || message.id === undefined) return;
    const call: PendingCall | undefined = this.pending.get(message.id);
    if (call === undefined) return;
    this.pending.delete(message.id);
    if (message.success === true) call.resolve(message.result);
    else call.reject(new Error(`HA ${message.error?.code ?? 'error'}: ${message.error?.message ?? 'unknown'}`));
  }

  private failAll(err: Error): void {
    for (const call of this.pending.values()) call.reject(err);
    this.pending.clear();
  }
}
