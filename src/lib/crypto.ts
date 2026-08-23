import crypto from "crypto";
import { encryptionKeySecret } from "./env";

// AES-256-GCM encryption of session tokens at rest.
// Key: CADENCE_ENCRYPTION_KEY as 64-char hex (preferred), or any string
// hashed with SHA-256. Format at rest: base64(iv).base64(tag).base64(ciphertext)

function getKey(): Buffer {
  const raw = encryptionKeySecret();
  if (!raw) {
    throw new Error(
      "CADENCE_ENCRYPTION_KEY is not set — generate one with `node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"`",
    );
  }
  return /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : crypto.createHash("sha256").update(raw).digest();
}

export function encryptJSON(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(value), "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(".");
}

export function decryptJSON<T>(blob: string): T {
  const [ivB64, tagB64, ctB64] = blob.split(".");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Malformed ciphertext");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(pt.toString("utf8")) as T;
}
