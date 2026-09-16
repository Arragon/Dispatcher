import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

export interface VerificationCommand {
  id: string;
  file: string;
  args: string[];
  required: boolean;
  timeoutMs: number;
  outputLimitBytes: number;
}

export interface VerificationResult {
  commandId: string;
  required: boolean;
  status: "passed" | "failed" | "timeout";
  exitCode: number | null;
  durationMs: number;
  output: string;
  truncated: boolean;
}

export class VerificationRegistry {
  private readonly commands = new Map<string, VerificationCommand>();
  register(command: VerificationCommand): void {
    if (!command.id || !command.file || command.timeoutMs <= 0 || command.outputLimitBytes <= 0) throw new Error("Invalid verification command");
    this.commands.set(command.id, structuredClone(command));
  }
  list(): VerificationCommand[] { return [...this.commands.values()].map((value) => structuredClone(value)); }

  async run(commandId: string, cwd: string): Promise<VerificationResult> {
    const command = this.commands.get(commandId);
    if (!command) throw new Error(`Verification command is not registered: ${commandId}`);
    const started = Date.now();
    try {
      const result = await execute(command.file, command.args, { cwd, timeout: command.timeoutMs, maxBuffer: command.outputLimitBytes * 2, encoding: "utf8" });
      const combined = `${result.stdout}${result.stderr}`;
      return this.result(command, "passed", 0, combined, started);
    } catch (error) {
      const detail = error as { stdout?: string; stderr?: string; code?: number | string; killed?: boolean };
      return this.result(command, detail.killed ? "timeout" : "failed", typeof detail.code === "number" ? detail.code : null, `${detail.stdout ?? ""}${detail.stderr ?? ""}`, started);
    }
  }

  blocksDelivery(results: VerificationResult[]): boolean { return results.some((result) => result.required && result.status !== "passed"); }

  private result(command: VerificationCommand, status: VerificationResult["status"], exitCode: number | null, output: string, started: number): VerificationResult {
    const bytes = Buffer.from(output);
    const truncated = bytes.length > command.outputLimitBytes;
    return { commandId: command.id, required: command.required, status, exitCode, durationMs: Date.now() - started, output: bytes.subarray(0, command.outputLimitBytes).toString("utf8"), truncated };
  }
}
