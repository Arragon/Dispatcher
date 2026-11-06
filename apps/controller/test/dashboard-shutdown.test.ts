import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get, type IncomingMessage } from "node:http";
import { ControllerService } from "../src/service.js";

it("stops with an authenticated dashboard event stream still open", async () => {
  const root = mkdtempSync(join(tmpdir(), "dashboard-shutdown-"));
  const service = new ControllerService({ dataDirectory: root, port: 0, ownerToken: "stream-owner", backgroundWorker: { enabled: false } });
  let response: IncomingMessage | undefined, stopping: Promise<void> | undefined;
  const streamEnded = Promise.withResolvers<void>();
  const request = { current: undefined as ReturnType<typeof get> | undefined };
  try {
    await service.start();
    await new Promise<void>((resolve, reject) => {
      request.current = get(`${service.app.listeningOrigin}/api/events`, { headers: { authorization: "Bearer stream-owner" } }, (received) => {
        response = received;
        expect(received.statusCode).toBe(200);
        received.once("end", () => streamEnded.resolve());
        received.once("data", () => resolve());
        received.on("data", () => undefined);
      });
      request.current.once("error", reject);
    });
    expect((await service.app.inject({ url: "/api/system-impact", headers: { authorization: "Bearer stream-owner" } })).json().dashboardClients).toBe(1);
    stopping = service.stop();
    let timer: ReturnType<typeof setTimeout>;
    const stopped = await Promise.race([Promise.all([stopping, streamEnded.promise]).then(() => true), new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), 1500); })]);
    clearTimeout(timer!);
    expect(stopped).toBe(true);
    expect(response.destroyed || response.readableEnded).toBe(true);
  } finally {
    response?.destroy(); request.current?.destroy();
    await (stopping ?? service.stop());
    rmSync(root, { recursive: true, force: true });
  }
});
