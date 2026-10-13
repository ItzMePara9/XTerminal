import { sshFingerprint } from "@xterminal/crypto";

/**
 * ssh2 passes the host key to `hostVerifier` in different shapes depending
 * on version: a raw public key Buffer, or a parsed key object. Normalize it
 * so fingerprinting works across versions.
 */
export function publicKeyBlob(key: unknown): Buffer {
  if (Buffer.isBuffer(key)) return key;
  if (key instanceof Uint8Array) return Buffer.from(key);
  const k = key as { data?: unknown; getPublicPart?: () => Buffer };
  if (k?.data) {
    return Buffer.isBuffer(k.data) ? k.data : Buffer.from(k.data as Uint8Array);
  }
  if (typeof k?.getPublicPart === "function") {
    const pub = k.getPublicPart();
    if (Buffer.isBuffer(pub)) return pub;
  }
  throw new Error("Unsupported host key format");
}

/** Key algorithm name for a host key, parsed out of the public key blob. */
export function keyTypeFromBlob(blob: Buffer): string {
  // SSH wire format: uint32 length + algorithm name string
  if (blob.length >= 4) {
    const len = blob.readUInt32BE(0);
    if (len > 0 && len <= 64 && 4 + len <= blob.length) {
      return blob.subarray(4, 4 + len).toString("ascii");
    }
  }
  return "unknown";
}

/** Key algorithm from a parsed ssh2 key object when available. */
export function keyTypeFromParsed(key: unknown): string | null {
  const k = key as { type?: string };
  return typeof k?.type === "string" ? k.type : null;
}

export function fingerprintHostKey(key: unknown): {
  fingerprint: string;
  keyType: string;
  blob: Buffer;
} {
  const blob = publicKeyBlob(key);
  return {
    fingerprint: sshFingerprint(blob),
    keyType: keyTypeFromParsed(key) ?? keyTypeFromBlob(blob),
    blob,
  };
}
