/**
 * Coalesces bursts of change signals into one run after a quiet period, never runs
 * two syncs at once, and re-runs on a fixed interval as a safety net for missed events.
 */
export class SyncScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private rerunRequested = false;

  constructor(
    private readonly sync: () => Promise<void>,
    private readonly debounceMs: number,
    private readonly safetyIntervalMs: number,
  ) {}

  start(): void {
    setInterval(() => this.request('safety interval'), this.safetyIntervalMs);
  }

  request(reason: string): void {
    console.log(JSON.stringify({ msg: 'sync requested', reason }));
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.runExclusive();
    }, this.debounceMs);
  }

  private async runExclusive(): Promise<void> {
    if (this.running) {
      this.rerunRequested = true;
      return;
    }
    this.running = true;
    try {
      await this.sync();
    } catch (err: unknown) {
      console.error(JSON.stringify({ msg: 'sync failed', error: err instanceof Error ? err.message : String(err) }));
    } finally {
      this.running = false;
      if (this.rerunRequested) {
        this.rerunRequested = false;
        void this.runExclusive();
      }
    }
  }
}
