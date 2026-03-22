/**
 * @deco/crypto
 *
 * E2E encryption for Deco using tweetnacl (X25519 + XSalsa20-Poly1305).
 * Pure JavaScript — no WASM, works in all bundlers including Turbopack.
 *
 * IMPORTANT: Private keys are NEVER sent to the server.
 * They are stored in the browser's IndexedDB only.
 */

import nacl from "tweetnacl";
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from "tweetnacl-util";
import type { KeyBackupPayload } from "@deco/types";

// ─── Key Generation ───────────────────────────────────────────────────────────

export function generateKeyPair(): { publicKey: string; privateKey: string } {
  const keypair = nacl.box.keyPair();
  return {
    publicKey: encodeBase64(keypair.publicKey),
    privateKey: encodeBase64(keypair.secretKey),
  };
}

// ─── Group Key Generation ─────────────────────────────────────────────────────

/** Generate a random 32-byte symmetric key for a group conversation. */
export function generateGroupKey(): string {
  return encodeBase64(nacl.randomBytes(nacl.secretbox.keyLength));
}

// ─── Shared Secret (X25519 Key Exchange) ─────────────────────────────────────

export function deriveSharedSecret(
  theirPublicKeyB64: string,
  myPrivateKeyB64: string
): string {
  const theirPublicKey = decodeBase64(theirPublicKeyB64);
  const myPrivateKey = decodeBase64(myPrivateKeyB64);
  const sharedSecret = nacl.scalarMult(myPrivateKey, theirPublicKey);
  return encodeBase64(sharedSecret);
}

// ─── Message Encryption (XSalsa20-Poly1305) ───────────────────────────────────

export function encryptMessage(plaintext: string, sharedSecretB64: string): string {
  const key = decodeBase64(sharedSecretB64);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const message = decodeUTF8(plaintext);
  const ciphertext = nacl.secretbox(message, nonce, key);

  // Pack nonce + ciphertext — nonce is safe to transmit
  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce);
  combined.set(ciphertext, nonce.length);

  return encodeBase64(combined);
}

export function decryptMessage(encryptedB64: string, sharedSecretB64: string): string {
  const key = decodeBase64(sharedSecretB64);
  const combined = decodeBase64(encryptedB64);

  const nonce = combined.slice(0, nacl.secretbox.nonceLength);
  const ciphertext = combined.slice(nacl.secretbox.nonceLength);

  const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
  if (!plaintext) throw new Error("Decryption failed — message may be corrupted or tampered with");

  return encodeUTF8(plaintext);
}

// ─── Key Storage (IndexedDB) ──────────────────────────────────────────────────

const DB_NAME = "deco_keys";
const STORE_NAME = "keys";

function toByteArray(input: Uint8Array | number[]): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(input) as Uint8Array<ArrayBuffer>;
}

function openKeyDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
  });
}

export async function storePrivateKey(userID: string, privateKeyB64: string): Promise<void> {
  const db = await openKeyDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(privateKeyB64, `private:${userID}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadPrivateKey(userID: string): Promise<string | null> {
  const db = await openKeyDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(`private:${userID}`);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function deletePrivateKey(userID: string): Promise<void> {
  const db = await openKeyDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(`private:${userID}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function encryptPrivateKeyForBackup(
  privateKeyB64: string,
  passphrase: string
): Promise<KeyBackupPayload> {
  if (!passphrase.trim()) {
    throw new Error("Passphrase is required");
  }
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Web Crypto is unavailable on this device");
  }

  const iterations = 250000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const encryptionKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations,
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    encryptionKey,
    new TextEncoder().encode(privateKeyB64)
  );

  return {
    version: 1,
    kdf: "pbkdf2-sha256",
    iterations,
    salt: encodeBase64(salt),
    cipher: "aes-gcm",
    iv: encodeBase64(iv),
    ciphertext: encodeBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptPrivateKeyBackup(
  payload: KeyBackupPayload,
  passphrase: string
): Promise<string> {
  validateKeyBackupPayload(payload);
  if (!passphrase.trim()) {
    throw new Error("Passphrase is required");
  }
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Web Crypto is unavailable on this device");
  }

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const decryptionKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toByteArray(decodeBase64(payload.salt)),
      iterations: payload.iterations,
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toByteArray(decodeBase64(payload.iv)) },
      decryptionKey,
      toByteArray(decodeBase64(payload.ciphertext))
    );

    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error("Incorrect passphrase");
  }
}

export function validateKeyBackupPayload(payload: KeyBackupPayload) {
  if (payload.version !== 1) {
    throw new Error("Unsupported key backup version");
  }
  if (payload.kdf !== "pbkdf2-sha256" || payload.cipher !== "aes-gcm") {
    throw new Error("Unsupported key backup format");
  }
  if (!payload.salt || !payload.iv || !payload.ciphertext || payload.iterations <= 0) {
    throw new Error("Invalid key backup payload");
  }
}
