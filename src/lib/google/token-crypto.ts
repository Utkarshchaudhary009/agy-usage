import "server-only";
import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
let cachedKey: Buffer | null = null;

const getEncryptionKey = (): Buffer => {
  if (cachedKey) return cachedKey;
  const keyHex = process.env.TOKEN_ENCRYPTION_KEY || "";
  if (!keyHex || keyHex.length !== 64) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).",
    );
  }
  cachedKey = Buffer.from(keyHex, "hex");
  return cachedKey;
};

export function encryptToken(plaintext: string): string {
  if (!plaintext) return "";

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");

  // Format: iv:authTag:encrypted
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decryptToken(ciphertext: string): string {
  if (!ciphertext) return "";

  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token format");
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
