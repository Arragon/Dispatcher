import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const PREFIX = "scrypt-v1";
const KEY_LENGTH = 64;

export function validOwnerPassword(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1024;
}

export async function hashOwnerPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH) as Buffer;
  return `${PREFIX}:${salt.toString("base64url")}:${derived.toString("base64url")}`;
}

export async function verifyOwnerPassword(password: string, stored: string): Promise<boolean> {
  if (!validOwnerPassword(password)) return false;
  const [prefix, saltEncoded, derivedEncoded, extra] = stored.split(":");
  if (prefix !== PREFIX || !saltEncoded || !derivedEncoded || extra !== undefined) return false;
  const salt = Buffer.from(saltEncoded, "base64url");
  const expected = Buffer.from(derivedEncoded, "base64url");
  if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
  const actual = await scrypt(password, salt, KEY_LENGTH) as Buffer;
  return timingSafeEqual(actual, expected);
}
