// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthGate, Navigation, SecureInput } from "../src/App.js";
import SettingsPage from "../src/SettingsPage.js";
import AgentsPage from "../src/AgentsPage.js";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Dashboard shell", () => {
  it("signs in with username and password without exposing the owner token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "/auth/session" && !init) return new Response(null, { status: 401 });
      if (input === "/auth/session" && init?.method === "POST") return new Response(JSON.stringify({ principal: { id: "owner" } }), { status: 201 });
      return new Response(null, { status: 404 });
    });
    render(<AuthGate><div>已进入控制台</div></AuthGate>);
    expect(await screen.findByRole("heading", { name: "登录 Agent Dispatcher" })).toBeTruthy();
    await userEvent.type(screen.getByLabelText("密码"), "example");
    await userEvent.click(screen.getAllByRole("button", { name: "登录" })[0]!);
    expect(await screen.findByText("已进入控制台")).toBeTruthy();
    expect(fetchMock.mock.calls).toContainEqual(["/auth/session", expect.objectContaining({ method: "POST", body: JSON.stringify({ username: "admin", password: "example" }) })]);
  });
  it("distinguishes installed harnesses from verified authentication", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (input === "/api/adapters/manifests") return new Response(JSON.stringify({ manifests: [{ id: "opencode", displayName: "OpenCode", platforms: ["darwin"], configSchema: { type: "object", properties: {} }, uiSchema: {}, secretFields: [], backends: [], capabilities: {} }] }));
      if (input === "/api/agents/profiles") return new Response(JSON.stringify({ profiles: [], sessions: [] }));
      if (input === "/api/adapters/compatibility") return new Response(JSON.stringify({ matrix: [] }));
      return new Response(JSON.stringify({ installed: true, compatible: true, authenticated: false, authentication: "unknown", version: "2.0.21", diagnostic: "Authentication remains unverified." }));
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><AgentsPage /></MemoryRouter></QueryClientProvider>);
    await userEvent.click((await screen.findAllByRole("button", { name: "添加账号" }))[0]!);
    await userEvent.click(await screen.findByRole("button", { name: "扫描并检查" }));
    expect(await screen.findByText(/Authentication remains unverified/)).toBeTruthy();
    expect(screen.queryByText(/health check passed/)).toBeNull();
  });
  it("shows a reserved account but excludes it from dispatch and enables it through the profile API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (input === "/api/adapters/manifests") return new Response(JSON.stringify({ manifests: [{ id: "codex", displayName: "Codex", platforms: ["darwin"], configSchema: { type: "object", properties: {} }, uiSchema: {}, secretFields: [], backends: [], capabilities: {} }] }));
      if (input === "/api/agents/profiles") return new Response(JSON.stringify({ profiles: [{ id: "kite", alias: "kite", provider: "codex", runnerId: "local", state: "DISABLED" }], sessions: [] }));
      return new Response(JSON.stringify({ matrix: [] }));
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><AgentsPage /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText("kite")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "kite (codex)" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "kite 详情" }));
    await userEvent.click(screen.getByRole("button", { name: "Enable dispatch for kite" }));
    expect(fetchMock.mock.calls).toContainEqual(["/api/agents/profiles/kite/enabled", expect.objectContaining({ method: "POST", body: JSON.stringify({ enabled: true }) })]);
  });
  it("exposes every M1 navigation surface", () => {
    render(<MemoryRouter><Navigation /></MemoryRouter>);
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeTruthy();
    for (const label of ["总览", "任务与运行", "发布任务", "Harness", "模型管理", "设备管理", "项目仓库", "平台集成", "执行策略", "诊断", "设置"]) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }
  });

  it("submits a secret outside the ordinary configuration form and clears the field", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ secret: { exists: true, backend: "macos-keychain" } }), { status: 201 }));
    render(<SecureInput namespace="linear" name="main" label="Linear credential" />);
    const input = screen.getByLabelText("Linear credential") as HTMLInputElement;
    await userEvent.type(input, "canary-secret-value");
    await userEvent.click(screen.getByRole("button", { name: "Store" }));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(input.value).toBe("");
    expect(window.location.href).not.toContain("canary-secret-value");
  });

  it("tests and deletes a stored secret without reading its value", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, secret: { lastTestedAt: "2026-09-16T00:00:00.000Z" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    render(<SecureInput namespace="linear" name="main" label="Linear credential" />);
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/Connection test passed/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Not configured")).toBeTruthy();
    expect(fetchMock.mock.calls.map(([path, init]) => [path, init?.method])).toEqual([
      ["/api/secrets/linear/main/test", "POST"],
      ["/api/secrets/linear/main", "DELETE"],
    ]);
  });

  it("submits the shared Draft 2020-12 schema through RJSF", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "/api/config") {
        return new Response(JSON.stringify({ revision: 0, updatedAt: "2026-09-16T00:00:00.000Z", config: { schemaVersion: 1 } }), { status: 200 });
      }
      if (input === "/api/config/schema") {
        return new Response(JSON.stringify({
          schema: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            additionalProperties: false,
            required: ["schemaVersion"],
            properties: { schemaVersion: { const: 1 } },
          },
          uiSchema: {},
        }), { status: 200 });
      }
      if (input === "/api/config/plans" && init?.method === "POST") {
        return new Response(JSON.stringify({ plan: { id: "plan-1", risk: "safe", requiresConfirmation: false, changes: [] } }), { status: 201 });
      }
      return new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><SettingsPage /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "预览配置变更" }));
    expect(await screen.findByText("配置与当前版本一致。")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/config/plans", expect.objectContaining({ method: "POST" }));
  });
});
