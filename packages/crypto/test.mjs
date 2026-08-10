import assert from 'node:assert/strict';
import test from 'node:test';
import nacl from '../../node_modules/.pnpm/tweetnacl@1.0.3/node_modules/tweetnacl/nacl-fast.js';
import naclUtil from '../../node_modules/.pnpm/tweetnacl-util@0.15.1/node_modules/tweetnacl-util/nacl-util.js';

const { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } = naclUtil;

function generateKeyPair() {
  const kp = nacl.box.keyPair();
  return { publicKey: encodeBase64(kp.publicKey), privateKey: encodeBase64(kp.secretKey) };
}

function deriveSharedSecret(theirPublicKeyB64, myPrivateKeyB64) {
  const pub = decodeBase64(theirPublicKeyB64);
  const priv = decodeBase64(myPrivateKeyB64);
  const shared = nacl.scalarMult(priv, pub);
  return encodeBase64(shared);
}

function encryptMessage(plaintext, sharedSecretB64) {
  const key = decodeBase64(sharedSecretB64);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const msg = decodeUTF8(plaintext);
  const ciphertext = nacl.secretbox(msg, nonce, key);

  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce);
  combined.set(ciphertext, nonce.length);
  return encodeBase64(combined);
}

function decryptMessage(encryptedB64, sharedSecretB64) {
  const key = decodeBase64(sharedSecretB64);
  const combined = decodeBase64(encryptedB64);
  const nonce = combined.slice(0, nacl.secretbox.nonceLength);
  const ciphertext = combined.slice(nacl.secretbox.nonceLength);
  const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
  if (!plaintext) throw new Error("Decryption failed — message may be corrupted or tampered with");
  return encodeUTF8(plaintext);
}

test('KeyPair Generation', () => {
  const kp = generateKeyPair();
  assert.ok(kp.publicKey.length > 0);
  assert.ok(kp.privateKey.length > 0);
});

test('X25519 Key Exchange & ECDH Shared Secret Symmetry', () => {
  const alice = generateKeyPair();
  const bob = generateKeyPair();

  const secretAlice = deriveSharedSecret(bob.publicKey, alice.privateKey);
  const secretBob = deriveSharedSecret(alice.publicKey, bob.privateKey);

  assert.equal(secretAlice, secretBob);
});

test('Message Encryption and Decryption', () => {
  const alice = generateKeyPair();
  const bob = generateKeyPair();
  const secret = deriveSharedSecret(bob.publicKey, alice.privateKey);

  const plaintext = "Hello from Deco E2E Messaging!";
  const encrypted = encryptMessage(plaintext, secret);
  assert.notEqual(encrypted, plaintext);

  const decrypted = decryptMessage(encrypted, secret);
  assert.equal(decrypted, plaintext);
});

test('Tampered Ciphertext Fails Decryption', () => {
  const alice = generateKeyPair();
  const bob = generateKeyPair();
  const secret = deriveSharedSecret(bob.publicKey, alice.privateKey);

  const encrypted = encryptMessage("Secret message", secret);
  const tampered = encrypted.slice(0, -4) + "AAAA";

  assert.throws(() => {
    decryptMessage(tampered, secret);
  }, /Decryption failed/);
});
