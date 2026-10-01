import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const OWNER_TOKEN_REFERENCE = "secret://controller/owner-token";
export const SESSION_COOKIE = "dispatcher_session";
export const CSRF_COOKIE = "dispatcher_csrf";
export const CSRF_HEADER = "x-dispatcher-csrf";
export const OWNER_PRINCIPAL_ID = "owner";
export const OWNER_ROLES: readonly string[] = ["admin", "operator"];

export interface ControlPrincipal {
  id: string;
  roles: string[];
  channel: "web" | "api";
  authenticatedBy: "bearer" | "session";
}

export interface ControlRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  ip: string;
}

export type ControlDecision =
  | { kind: "public" }
  | { kind: "authenticated"; principal: ControlPrincipal }
  | { kind: "rejected"; status: 400 | 401 | 403 | 429; code: string; message: string; retryAfterSeconds?: number };

export interface ControlSession {
  sessionId: string;
  csrfToken: string;
  expiresAt: string;
}

export interface ControlAuthOptions {
  resolveOwnerToken: () => Promise<string>;
  allowedHosts: readonly string[];
  clock?: () => Date;
  sessionTtlMs?: number;
  loginCodeTtlMs?: number;
  requestsPerMinute?: number;
  authFailuresPerWindow?: number;
  authFailureWindowMs?: number;
  ownerTokenCacheMs?: number;
}

type RouteClass = "public" | "signed" | "login" | "protected";

interface Window {
  startedAt: number;
  count: number;
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function safeEqual(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right));
}

function header(headers: ControlRequest["headers"], name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function hostname(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith("[")) return trimmed.slice(1, trimmed.indexOf("]"));
  const colon = trimmed.lastIndexOf(":");
  return colon > 0 && trimmed.indexOf(":") === colon ? trimmed.slice(0, colon) : trimmed;
}

export function parseCookies(value: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (value ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const raw = part.slice(separator + 1).trim();
    try {
      cookies.set(name, decodeURIComponent(raw));
    } catch {
      continue;
    }
  }
  return cookies;
}

export function classifyControlRoute(method: string, url: string): RouteClass {
  const path = url.split("?")[0] ?? url;
  if (method === "POST" && /^\/api\/connectors\/[^/]+\/webhook$/.test(path)) return "signed";
  if (method === "POST" && path === "/api/runners/enroll") return "signed";
  if (method === "GET" && path === "/auth/messaging") return "public";
  if (method === "POST" && path === "/auth/session") return "login";
  if (path.startsWith("/api/") || path === "/api" || path.startsWith("/auth/")) return "protected";
  return "public";
}

export class ControlPlaneAuth {
  private readonly sessions = new Map<string, { csrfToken: string; expiresAt: number }>();
  private readonly loginCodes = new Map<string, number>();
  private readonly requestWindows = new Map<string, Window>();
  private readonly failureWindows = new Map<string, Window>();
  private readonly allowedHosts: Set<string>;
  private cachedOwnerToken: { value: string; expiresAt: number } | undefined;

  constructor(private readonly options: ControlAuthOptions) {
    this.allowedHosts = new Set(options.allowedHosts.map((host) => hostname(host)));
  }

  async evaluate(request: ControlRequest): Promise<ControlDecision> {
    const method = request.method.toUpperCase();
    const route = classifyControlRoute(method, request.url);
    if (route === "public") return { kind: "public" };
    const now = this.nowMs();
    this.prune(now);
    if (!this.consumeWindow(this.requestWindows, request.ip, 60_000, this.options.requestsPerMinute ?? 600, now)) {
      return { kind: "rejected", status: 429, code: "RATE_LIMITED", message: "Too many requests", retryAfterSeconds: 60 };
    }
    if (route === "signed") {
      if (request.url.split("?")[0] === "/api/runners/enroll" && this.lockedOut(request.ip, now)) {
        return { kind: "rejected", status: 429, code: "AUTH_LOCKED", message: "Too many failed authentication attempts", retryAfterSeconds: Math.ceil(this.failureWindowMs() / 1_000) };
      }
      return { kind: "public" };
    }
    const host = header(request.headers, "host");
    if (!host || !this.allowedHosts.has(hostname(host))) return { kind: "rejected", status: 403, code: "HOST_REJECTED", message: "Host is not allowed" };
    if (header(request.headers, "sec-fetch-site") === "cross-site") return { kind: "rejected", status: 403, code: "ORIGIN_REJECTED", message: "Cross-site requests are not allowed" };
    if (UNSAFE_METHODS.has(method) && !this.sameOrigin(header(request.headers, "origin"), host)) {
      return { kind: "rejected", status: 403, code: "ORIGIN_REJECTED", message: "Origin is not allowed" };
    }
    if (this.lockedOut(request.ip, now)) {
      return { kind: "rejected", status: 429, code: "AUTH_LOCKED", message: "Too many failed authentication attempts", retryAfterSeconds: Math.ceil(this.failureWindowMs() / 1_000) };
    }
    if (route === "login") return { kind: "public" };
    const authorization = header(request.headers, "authorization");
    if (authorization?.startsWith("Bearer ")) {
      if (await this.matchesOwnerToken(authorization.slice("Bearer ".length).trim())) return { kind: "authenticated", principal: this.principal("api", "bearer") };
      this.recordFailure(request.ip);
      return { kind: "rejected", status: 401, code: "AUTH_REQUIRED", message: "Authentication is required" };
    }
    const sessionId = parseCookies(header(request.headers, "cookie")).get(SESSION_COOKIE);
    const session = sessionId ? this.sessions.get(digest(sessionId).toString("hex")) : undefined;
    if (!session || session.expiresAt <= now) {
      if (sessionId) this.recordFailure(request.ip);
      return { kind: "rejected", status: 401, code: "AUTH_REQUIRED", message: "Authentication is required" };
    }
    if (UNSAFE_METHODS.has(method)) {
      const supplied = header(request.headers, CSRF_HEADER);
      if (!supplied || !safeEqual(supplied, session.csrfToken)) return { kind: "rejected", status: 403, code: "CSRF_REJECTED", message: "A valid CSRF token is required" };
    }
    return { kind: "authenticated", principal: this.principal("web", "session") };
  }

  issueLoginCode(): { code: string; expiresAt: string } {
    const now = this.nowMs();
    const code = randomBytes(24).toString("base64url");
    const expiresAt = now + (this.options.loginCodeTtlMs ?? 10 * 60_000);
    this.loginCodes.set(digest(code).toString("hex"), expiresAt);
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  async createSession(credential: { token?: string; code?: string }, ip: string): Promise<ControlSession | undefined> {
    const now = this.nowMs();
    let accepted = false;
    if (typeof credential.code === "string" && credential.code) {
      const key = digest(credential.code).toString("hex");
      const expiresAt = this.loginCodes.get(key);
      this.loginCodes.delete(key);
      accepted = expiresAt !== undefined && expiresAt > now;
    } else if (typeof credential.token === "string" && credential.token) {
      accepted = await this.matchesOwnerToken(credential.token);
    }
    if (!accepted) {
      this.recordFailure(ip);
      return undefined;
    }
    const sessionId = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(24).toString("base64url");
    const expiresAt = now + (this.options.sessionTtlMs ?? 12 * 60 * 60_000);
    this.sessions.set(digest(sessionId).toString("hex"), { csrfToken, expiresAt });
    return { sessionId, csrfToken, expiresAt: new Date(expiresAt).toISOString() };
  }

  revokeSession(cookieHeader: string | undefined): void {
    const sessionId = parseCookies(cookieHeader).get(SESSION_COOKIE);
    if (sessionId) this.sessions.delete(digest(sessionId).toString("hex"));
  }

  revokeAllSessions(): void {
    this.sessions.clear();
    this.loginCodes.clear();
    this.cachedOwnerToken = undefined;
  }

  sessionCsrfToken(cookieHeader: string | undefined): string | undefined {
    const sessionId = parseCookies(cookieHeader).get(SESSION_COOKIE);
    return sessionId ? this.sessions.get(digest(sessionId).toString("hex"))?.csrfToken : undefined;
  }

  recordFailure(ip: string): void {
    this.consumeWindow(this.failureWindows, ip, this.failureWindowMs(), Number.MAX_SAFE_INTEGER, this.nowMs());
  }

  sessionCookies(session: ControlSession, secure: boolean): string[] {
    const maxAge = Math.max(0, Math.floor((Date.parse(session.expiresAt) - this.nowMs()) / 1_000));
    const suffix = `Path=/; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
    return [
      `${SESSION_COOKIE}=${session.sessionId}; HttpOnly; ${suffix}`,
      `${CSRF_COOKIE}=${session.csrfToken}; ${suffix}`,
    ];
  }

  clearedCookies(): string[] {
    return [SESSION_COOKIE, CSRF_COOKIE].map((name) => `${name}=; Path=/; SameSite=Strict; Max-Age=0`);
  }

  private principal(channel: ControlPrincipal["channel"], authenticatedBy: ControlPrincipal["authenticatedBy"]): ControlPrincipal {
    return { id: OWNER_PRINCIPAL_ID, roles: [...OWNER_ROLES], channel, authenticatedBy };
  }

  private async matchesOwnerToken(candidate: string): Promise<boolean> {
    if (!candidate) return false;
    const now = this.nowMs();
    if (!this.cachedOwnerToken || this.cachedOwnerToken.expiresAt <= now) {
      this.cachedOwnerToken = { value: await this.options.resolveOwnerToken(), expiresAt: now + (this.options.ownerTokenCacheMs ?? 30_000) };
    }
    return safeEqual(candidate, this.cachedOwnerToken.value);
  }

  private sameOrigin(origin: string | undefined, host: string): boolean {
    if (!origin) return true;
    try {
      const parsed = new URL(origin);
      return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host.toLowerCase();
    } catch {
      return false;
    }
  }

  private lockedOut(ip: string, now: number): boolean {
    const window = this.failureWindows.get(ip);
    return window !== undefined && now - window.startedAt < this.failureWindowMs() && window.count >= (this.options.authFailuresPerWindow ?? 10);
  }

  private consumeWindow(windows: Map<string, Window>, key: string, durationMs: number, limit: number, now: number): boolean {
    const current = windows.get(key);
    if (!current || now - current.startedAt >= durationMs) {
      windows.set(key, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  }

  private prune(now: number): void {
    if (this.requestWindows.size > 1_024) for (const [key, window] of this.requestWindows) if (now - window.startedAt >= 60_000) this.requestWindows.delete(key);
    if (this.failureWindows.size > 1_024) for (const [key, window] of this.failureWindows) if (now - window.startedAt >= this.failureWindowMs()) this.failureWindows.delete(key);
    for (const [key, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(key);
    for (const [key, expiresAt] of this.loginCodes) if (expiresAt <= now) this.loginCodes.delete(key);
  }

  private failureWindowMs(): number {
    return this.options.authFailureWindowMs ?? 5 * 60_000;
  }

  private nowMs(): number {
    return (this.options.clock ?? (() => new Date()))().getTime();
  }
}
