/**
 * @deco/crypto
 *
 * All cryptographic operations for Deco.
 * Uses libsodium (XSalsa20-Poly1305) for symmetric encryption
 * and X25519 for key exchange.
 *
 * IMPORTANT: Keys are NEVER sent to the server.
 * Private keys are stored in the browser's IndexedDB (encrypted with the user's passphrase).
 */

import sodium from "libsodium-wrappers";

let ready = false;

async function ensureReady() {
  if (!ready) {
    await sodium.ready;
    ready = true;
  }
}

// ─── Key Generation ───────────────────────────────────────────────────────────

export async function generateKeyPair(): Promise<{
  publicKey: string;  // Base64 — safe to store on server (used for key exchange)
  privateKey: string; // Base64 — NEVER leaves the client
}> {
  await ensureReady();
  const keypair = sodium.crypto_box_keypair();
  return {
    publicKey: sodium.to_base64(keypair.publicKey),
    privateKey: sodium.to_base64(keypair.privateKey),
  };
}

// ─── Shared Secret (Key Exchange) ─────────────────────────────────────────────

export async function deriveSharedSecret(
  theirPublicKeyB64: string,
  myPrivateKeyB64: string
): Promise<string> {
  await ensureReady();
  const theirPublicKey = sodium.from_base64(theirPublicKeyB64);
  const myPrivateKey = sodium.from_base64(myPrivateKeyB64);
  const sharedSecret = sodium.crypto_scalarmult(myPrivateKey, theirPublicKey);
  return sodium.to_base64(sharedSecret);
}

// ─── Message Encryption ───────────────────────────────────────────────────────

export async function encryptMessage(
  plaintext: string,
  sharedSecretB64: string
): Promise<string> {
  await ensureReady();
  const key = sodium.from_base64(sharedSecretB64);
  // Derive a 32-byte symmetric key from the shared secret
  const symmetricKey = sodium.crypto_generichash(32, key);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const message = sodium.from_string(plaintext);
  const ciphertext = sodium.crypto_secretbox_easy(message, nonce, symmetricKey);

  // Pack nonce + ciphertext together — nonce is safe to transmit
  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce);
  combined.set(ciphertext, nonce.length);

  return sodium.to_base64(combined);
}

export async function decryptMessage(
  encryptedB64: string,
  sharedSecretB64: string
): Promise<string> {
  await ensureReady();
  const key = sodium.from_base64(sharedSecretB64);
  const symmetricKey = sodium.crypto_generichash(32, key);
  const combined = sodium.from_base64(encryptedB64);

  const nonce = combined.slice(0, sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = combined.slice(sodium.crypto_secretbox_NONCEBYTES);

  const plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, symmetricKey);
  if (!plaintext) throw new Error("Decryption failed — message may be corrupted");

  return sodium.to_string(plaintext);
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
