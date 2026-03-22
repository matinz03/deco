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

// ─── Key Generation ───────────────────────────────────────────────────────────

export function generateKeyPair(): { publicKey: string; privateKey: string } {
  const keypair = nacl.box.keyPair();
  return {
    publicKey: encodeBase64(keypair.publicKey),
    privateKey: encodeBase64(keypair.secretKey),
  };
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
