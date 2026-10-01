export interface BackgroundJob {
  name: string;
  run(): Promise<void>;
}

export interface BackgroundLoopOptions {
  intervalMs: number;
  onError(job: string, error: unknown): void;
}

export function backoffDelayMs(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

export async function runBounded<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await worker(item as T);
    }
  });
  await Promise.all(lanes);
}

export class BackgroundLoop {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private running = false;

  constructor(
    private readonly jobs: readonly BackgroundJob[],
    private readonly options: BackgroundLoopOptions,
  ) {
    if (!Number.isFinite(options.intervalMs) || options.intervalMs < 10) throw new Error("Background interval must be at least 10ms");
  }

  get active(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  tick(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runJobs().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  private async runJobs(): Promise<void> {
    for (const job of this.jobs) {
      try {
        await job.run();
      } catch (error) {
        this.options.onError(job.name, error);
      }
    }
  }

  private schedule(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick().finally(() => this.schedule(this.options.intervalMs));
    }, delayMs);
    this.timer.unref();
  }
}
