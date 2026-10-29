/**
 * Users' GitHub tokens are stored encrypted with AES-256-GCM under a server-only
 * key (THEPOLISHER_SESSION_SECRET). GCM also authenticates the data, so a
 * tampered value fails to decrypt instead of yielding a wrong token.
 *
 * Format: "v1.<iv>.<auth tag>.<ciphertext>", each part base64url.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;

function keyBytes(key: string): Buffer {
  const bytes = Buffer.from(key, "base64url");
  if (bytes.length !== 32) throw new Error("THEPOLISHER_SESSION_SECRET must be 32 bytes, base64url-encoded.");
  return bytes;
}

/**
 * `context` (optional) is authenticated but not stored: the value then decrypts
 * only with the same context, e.g. the account it belongs to.
 */
export function encryptToken(plain: string, key: string, context?: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(key), iv);
  if (context) cipher.setAAD(Buffer.from(context, "utf8"));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptToken(sealed: string, key: string, context?: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("Unrecognised encrypted token.");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(key), Buffer.from(iv, "base64url"));
  if (context) decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
