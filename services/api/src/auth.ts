import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;
const N = 16384,
  R = 8,
  P = 1,
  KEYLEN = 64;

/** Stored as scrypt:N:r:p:salt:hash (base64), so the cost can change later. */
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt:${N}:${R}:${P}:${salt.toString("base64")}:${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored?: string | null) {
  const [kind, n, r, p, salt, hash] = (stored ?? "").split(":");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(
    password,
    Buffer.from(salt, "base64"),
    expected.length,
    { N: Number(n), r: Number(r), p: Number(p) },
  );
  return timingSafeEqual(actual, expected);
}

/**
 * One spelling per number, so "081 234 5678" and "+264812345678" are the same
 * account. Local numbers starting with 0 are Namibian (+264).
 */
export function normalizePhone(raw: string): string | null {
  let p = raw.replace(/[\s\-().]/g, "");
  if (p.startsWith("00")) p = "+" + p.slice(2);
  else if (p.startsWith("0")) p = "+264" + p.slice(1);
  else if (/^264\d/.test(p)) p = "+" + p;
  return /^\+[1-9]\d{7,14}$/.test(p) ? p : null;
}
