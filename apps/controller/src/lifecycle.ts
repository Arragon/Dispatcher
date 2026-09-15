export type LifecycleState = "CREATED" | "STARTING" | "READY" | "DEGRADED" | "STOPPING" | "STOPPED" | "FAILED";

export interface ServiceModule {
  name: string;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
}

export class LifecycleManager {
  private started: ServiceModule[] = [];
  state: LifecycleState = "CREATED";

  constructor(private readonly modules: ServiceModule[]) {}

  async start(): Promise<void> {
    if (this.state === "READY") return;
    if (this.state !== "CREATED" && this.state !== "STOPPED") throw new Error(`Cannot start lifecycle from ${this.state}`);
    this.state = "STARTING";
    this.started = [];
    try {
      for (const module of this.modules) {
        await module.start();
        this.started.push(module);
      }
      this.state = "READY";
    } catch (error) {
      this.state = "FAILED";
      await this.stopStarted();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.state === "STOPPED" || this.state === "CREATED") {
      this.state = "STOPPED";
      return;
    }
    if (this.state === "STOPPING") return;
    this.state = "STOPPING";
    await this.stopStarted();
    this.state = "STOPPED";
  }

  markDegraded(): void {
    if (this.state === "READY") this.state = "DEGRADED";
  }

  private async stopStarted(): Promise<void> {
    const failures: unknown[] = [];
    for (const module of [...this.started].reverse()) {
      try {
        await module.stop();
      } catch (error) {
        failures.push(error);
      }
    }
    this.started = [];
    if (failures.length > 0) throw new AggregateError(failures, "One or more service modules failed to stop");
  }
}
