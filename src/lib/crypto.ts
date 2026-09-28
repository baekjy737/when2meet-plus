import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const newId = (bytes = 6) => randomBytes(bytes).toString("base64url");
export const newSecret = () => randomBytes(24).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pw, salt, 32).toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  return safeEqualHex(scryptSync(pw, Buffer.from(salt, "hex"), 32).toString("hex"), hash);
}
