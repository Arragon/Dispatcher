import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { DeliveryCandidate } from "@dispatcher/workspace";
import { nativeSnapshotFixture } from "./fixtures/native-snapshot.js";

type Fixture = Awaited<ReturnType<typeof nativeSnapshotFixture>>;
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const commandFacts = (f: Fixture) => f.service.database.listEntities("local-git-command");

it("delivers a verified HUMAN-return native snapshot through the frozen push and PR to REVIEW", async () => {
  const f = await nativeSnapshotFixture({ delivery: "pull-request", scm: "confirm" });
  try {
    const original = git(f.repo, "rev-parse", "HEAD"), response = await f.advance();
    f.facts({ response: response.json(), commands: commandFacts(f), posts: f.scmPosts });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ run: { state: "COMPLETE", prUrl: "https://github.com/acme/repo/pull/1" }, task: { state: "REVIEW" } });
    const pointer = f.service.database.getEntity("run-snapshot-current", f.run.id) as { id: string };
    const proof = f.service.database.getEntity("run-snapshot-verification", pointer.id) as unknown as { state: string; snapshot: DeliveryCandidate };
    const result = f.service.database.getEntity("run-result", f.run.id) as unknown as { deliveryState: string; commit: { commit: string }; push: { commit: string }; branch: string };
    expect(proof.state).toBe("VERIFIED");
    expect(result).toMatchObject({ deliveryState: "complete", commit: { created: true, files: ["result.txt"] }, push: { target: { repository: "acme/repo" } } });
    expect(result.push.commit).toBe(result.commit.commit);
    expect(git(f.run.worktree!, "rev-parse", `${result.commit.commit}^{tree}`)).toBe(proof.snapshot.tree);
    expect(result.commit.commit).not.toBe(proof.snapshot.commit);
    expect(git(proof.snapshot.path, "rev-parse", "HEAD")).toBe(proof.snapshot.commit);
    expect(git(join(f.root, "bare.git"), "rev-parse", `refs/heads/${result.branch}`)).toBe(result.commit.commit);
    expect(git(f.repo, "rev-parse", "HEAD")).toBe(original);
    expect(f.scmPosts).toHaveLength(1); expect(f.starts()).toBe(1);
    expect(f.scmRequests.some(request => request.path.includes("/merge"))).toBe(false);
    const commands = commandFacts(f), children = f.children();
    expect((await f.advance()).json()).toMatchObject({ run: { state: "COMPLETE" }, task: { state: "REVIEW" } });
    expect(commandFacts(f)).toEqual(commands); expect(f.children()).toEqual(children); expect(f.scmPosts).toHaveLength(1);
  } finally { await f.close(); }
});

it("recovers a lost native snapshot PR response by lookup without another commit, push or POST", async () => {
  const f = await nativeSnapshotFixture({ delivery: "pull-request", scm: "confirm" });
  try {
    f.scmControl.loseResponse = true;
    expect((await f.advance()).statusCode).toBeGreaterThanOrEqual(400);
    const pushed = f.service.database.getEntity("run-result", f.run.id);
    expect(pushed).toMatchObject({ deliveryState: "pushed", push: { commit: expect.any(String) } });
    const commands = commandFacts(f), children = f.children();
    expect(f.scmPosts).toHaveLength(1);
    f.scmControl.hideExisting = true;
    expect((await f.advance()).statusCode).toBeGreaterThanOrEqual(400);
    expect(f.scmPosts).toHaveLength(1); expect(commandFacts(f)).toEqual(commands);
    f.scmControl.hideExisting = false;
    const recovered = await f.advance();
    f.facts({ recovered: recovered.json(), pushed, commands: commandFacts(f), posts: f.scmPosts });
    expect(recovered.statusCode, recovered.body).toBe(200);
    expect(recovered.json()).toMatchObject({ run: { state: "COMPLETE" }, task: { state: "REVIEW" } });
    expect(f.service.database.getEntity("run-result", f.run.id)).toMatchObject({ deliveryState: "complete" });
    expect(commandFacts(f)).toEqual(commands); expect(f.children()).toEqual(children); expect(f.scmPosts).toHaveLength(1); expect(f.starts()).toBe(1);
  } finally { await f.close(); }
});

it("rolls back native PR completion on final control drift while retaining its actual Git and PR receipts", async () => {
  const f = await nativeSnapshotFixture({ delivery: "pull-request", scm: "confirm" });
  try {
    const database = f.service.database;
    database.handle.exec(`CREATE TRIGGER native_pr_final_control AFTER UPDATE ON canonical_tasks WHEN json_extract(NEW.document_json,'$.state')='REVIEW' BEGIN UPDATE session_controls SET revision=revision+1 WHERE session_id='${f.run.sessionId.replaceAll("'", "''")}'; END`);
    const failed = await f.advance();
    expect(failed.statusCode, failed.body).toBe(409);
    expect(database.getEntity("run", f.run.id)).toMatchObject({ state: "DELIVERING" });
    expect(database.getCanonicalTask(f.run.taskId)?.document).toMatchObject({ state: "VERIFYING" });
    expect(database.getEntity("run-result", f.run.id)).toMatchObject({ deliveryState: "pushed" });
    expect(f.scmPosts).toHaveLength(1);
    const commands = commandFacts(f), children = f.children();
    database.handle.exec("DROP TRIGGER native_pr_final_control");
    const recovered = await f.advance();
    f.facts({ failed: failed.json(), recovered: recovered.json(), commands: commandFacts(f) });
    expect(recovered.statusCode, recovered.body).toBe(200);
    expect(recovered.json()).toMatchObject({ run: { state: "COMPLETE" }, task: { state: "REVIEW" } });
    expect(commandFacts(f)).toEqual(commands); expect(f.children()).toEqual(children); expect(f.scmPosts).toHaveLength(1); expect(f.starts()).toBe(1);
  } finally { try { f.service.database.handle.exec("DROP TRIGGER IF EXISTS native_pr_final_control"); } finally { await f.close(); } }
});
