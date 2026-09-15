import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

export interface SecretAccessContext {
  principal: string;
  purpose: "integration" | "provider" | "llm" | "test";
}

export interface SecretMetadata {
  reference: string;
  backend: "macos-keychain" | "encrypted-local";
  exists: boolean;
}

export interface SecretStore {
  put(reference: string, value: string): Promise<SecretMetadata>;
  delete(reference: string): Promise<void>;
  test(reference: string, context: SecretAccessContext): Promise<boolean>;
  metadata(reference: string): Promise<SecretMetadata>;
  resolve(reference: string, context: SecretAccessContext): Promise<string>;
}

export class SecretStoreError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SecretStoreError";
  }
}

export function parseSecretReference(reference: string): { namespace: string; name: string } {
  const match = /^secret:\/\/([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._/-]*)$/.exec(reference);
  if (!match?.[1] || !match[2] || match[2].includes("..")) {
    throw new SecretStoreError("INVALID_SECRET_REFERENCE", "Secret reference must use secret://namespace/name");
  }
  return { namespace: match[1], name: match[2] };
}

function authorize(context: SecretAccessContext): void {
  if (!(context.principal === "controller" || context.principal.startsWith("runner:"))) {
    throw new SecretStoreError("SECRET_ACCESS_DENIED", "Secret access denied");
  }
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export type CommandExecutor = (file: string, args: string[], stdin?: string) => Promise<CommandResult>;

const execute: CommandExecutor = async (file, args, stdin) =>
  await new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new SecretStoreError("KEYCHAIN_COMMAND_FAILED", "macOS Keychain operation failed"));
    });
    if (stdin !== undefined) child.stdin.end(`${stdin}\n`);
    else child.stdin.end();
  });

export class MacOsKeychainSecretStore implements SecretStore {
  constructor(
    private readonly executor: CommandExecutor = execute,
    private readonly service = "AgentDispatcher",
  ) {}

  async put(reference: string, value: string): Promise<SecretMetadata> {
    parseSecretReference(reference);
    if (!value) throw new SecretStoreError("EMPTY_SECRET", "Secret value cannot be empty");
    await this.executor("/usr/bin/security", ["add-generic-password", "-U", "-a", reference, "-s", this.service, "-w"], value);
    return { reference, backend: "macos-keychain", exists: true };
  }

  async delete(reference: string): Promise<void> {
    parseSecretReference(reference);
    await this.executor("/usr/bin/security", ["delete-generic-password", "-a", reference, "-s", this.service]);
  }

  async resolve(reference: string, context: SecretAccessContext): Promise<string> {
    parseSecretReference(reference);
    authorize(context);
    const result = await this.executor("/usr/bin/security", ["find-generic-password", "-w", "-a", reference, "-s", this.service]);
    return result.stdout.replace(/\r?\n$/, "");
  }

  async test(reference: string, context: SecretAccessContext): Promise<boolean> {
    return (await this.resolve(reference, context)).length > 0;
  }

  async metadata(reference: string): Promise<SecretMetadata> {
    parseSecretReference(reference);
    try {
      await this.executor("/usr/bin/security", ["find-generic-password", "-a", reference, "-s", this.service]);
      return { reference, backend: "macos-keychain", exists: true };
    } catch {
      return { reference, backend: "macos-keychain", exists: false };
    }
  }
}

interface EncryptedEnvelope {
  version: 1;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export class EncryptedLocalSecretStore implements SecretStore {
  private readonly masterKey: string;

  constructor(
    private readonly path: string,
    masterKey: string,
  ) {
    if (masterKey.length < 16) throw new SecretStoreError("WEAK_SECRET_STORE_KEY", "Encrypted secret store key must be at least 16 characters");
    this.masterKey = masterKey;
  }

  async put(reference: string, value: string): Promise<SecretMetadata> {
    parseSecretReference(reference);
    if (!value) throw new SecretStoreError("EMPTY_SECRET", "Secret value cannot be empty");
    const values = this.readValues();
    values[reference] = value;
    this.writeValues(values);
    return { reference, backend: "encrypted-local", exists: true };
  }

  async delete(reference: string): Promise<void> {
    parseSecretReference(reference);
    const values = this.readValues();
    delete values[reference];
    this.writeValues(values);
  }

  async resolve(reference: string, context: SecretAccessContext): Promise<string> {
    parseSecretReference(reference);
    authorize(context);
    const value = this.readValues()[reference];
    if (!value) throw new SecretStoreError("SECRET_NOT_FOUND", "Secret does not exist");
    return value;
  }

  async test(reference: string, context: SecretAccessContext): Promise<boolean> {
    return (await this.resolve(reference, context)).length > 0;
  }

  async metadata(reference: string): Promise<SecretMetadata> {
    parseSecretReference(reference);
    return { reference, backend: "encrypted-local", exists: Boolean(this.readValues()[reference]) };
  }

  private readValues(): Record<string, string> {
    if (!existsSync(this.path)) return {};
    const mode = statSync(this.path).mode & 0o777;
    if ((mode & 0o077) !== 0) throw new SecretStoreError("INSECURE_SECRET_STORE_PERMISSIONS", "Encrypted secret store permissions must be 0600");
    try {
      const envelope = JSON.parse(readFileSync(this.path, "utf8")) as EncryptedEnvelope;
      if (envelope.version !== 1) throw new Error("Unsupported envelope");
      const key = scryptSync(this.masterKey, Buffer.from(envelope.salt, "base64"), 32);
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const clear = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");
      return JSON.parse(clear) as Record<string, string>;
    } catch (error) {
      if (error instanceof SecretStoreError) throw error;
      throw new SecretStoreError("SECRET_STORE_DECRYPT_FAILED", "Encrypted secret store could not be decrypted", { cause: error });
    }
  }

  private writeValues(values: Record<string, string>): void {
    const directory = dirname(this.path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(this.masterKey, salt, 32);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(values), "utf8"), cipher.final()]);
    const envelope: EncryptedEnvelope = {
      version: 1,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify(envelope), { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.path);
    chmodSync(this.path, 0o600);
  }
}

export function createDefaultSecretStore(input: {
  dataDirectory: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
}): SecretStore {
  const platform = input.platform ?? process.platform;
  if (platform === "darwin") return new MacOsKeychainSecretStore();
  const key = (input.environment ?? process.env).DISPATCHER_SECRET_STORE_KEY;
  if (!key) {
    throw new SecretStoreError("SECRET_STORE_UNAVAILABLE", "Set DISPATCHER_SECRET_STORE_KEY when a platform keychain is unavailable");
  }
  return new EncryptedLocalSecretStore(`${input.dataDirectory}/secrets.enc`, key);
}
