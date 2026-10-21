import { expect, it } from "vitest";
import { childExecutionEnvironment } from "../src/index.js";

it("removes Controller authority keys after overrides without discarding provider context", () => {
  const parent = { DISPATCHER_OWNER_TOKEN: "fixture-owner", DISPATCHER_SECRET_STORE_KEY: "fixture-key", PATH: "/bin", CODEX_HOME: "/native", OPENAI_API_KEY: "fixture-provider", DISPATCHER_DATA_DIR: "/data", ABSENT: undefined };
  expect(childExecutionEnvironment(parent, { PWD: "/work", dispatcher_owner_token: "fixture-overlay" })).toEqual({ PATH: "/bin", CODEX_HOME: "/native", OPENAI_API_KEY: "fixture-provider", DISPATCHER_DATA_DIR: "/data", PWD: "/work" });
  expect(parent.DISPATCHER_OWNER_TOKEN).toBe("fixture-owner");
});
