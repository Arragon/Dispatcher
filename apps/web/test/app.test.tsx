// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigation, SecureInput } from "../src/App.js";
import SettingsPage from "../src/SettingsPage.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Dashboard shell", () => {
  it("exposes every M1 navigation surface", () => {
    render(<MemoryRouter><Navigation /></MemoryRouter>);
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeTruthy();
    for (const label of ["Overview / Fleet", "Tasks & Runs", "Runners", "Agents & Profiles", "Internal LLM", "Integrations", "Policies", "Logs & Diagnostics", "Settings"]) {
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
    await userEvent.click(await screen.findByRole("button", { name: "Build configuration plan" }));
    expect(await screen.findByText("Configuration is already current.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/config/plans", expect.objectContaining({ method: "POST" }));
  });
});
