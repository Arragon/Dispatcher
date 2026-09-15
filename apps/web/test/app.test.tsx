// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Navigation, SecureInput } from "../src/App.js";

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
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ secret: { exists: true } }), { status: 201 }));
    render(<SecureInput namespace="linear" name="main" label="Linear credential" />);
    const input = screen.getByLabelText("Linear credential") as HTMLInputElement;
    await userEvent.type(input, "canary-secret-value");
    await userEvent.click(screen.getByRole("button", { name: "Store" }));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(input.value).toBe("");
    expect(window.location.href).not.toContain("canary-secret-value");
  });
});
