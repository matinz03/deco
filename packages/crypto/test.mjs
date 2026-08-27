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

function generateGroupKey() {
  return encodeBase64(nacl.randomBytes(nacl.secretbox.keyLength));
}

function encryptBlob(data, keyB64) {
  const key = decodeBase64(keyB64);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(data, nonce, key);

  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce);
  combined.set(ciphertext, nonce.length);
  return combined;
}

function decryptBlob(encrypted, keyB64) {
  const key = decodeBase64(keyB64);

  if (encrypted.length < nacl.secretbox.nonceLength + nacl.secretbox.overheadLength) {
    throw new Error("Decryption failed — attachment may be corrupted or tampered with");
  }

  const nonce = encrypted.slice(0, nacl.secretbox.nonceLength);
  const ciphertext = encrypted.slice(nacl.secretbox.nonceLength);
  const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
  if (!plaintext) throw new Error("Decryption failed — attachment may be corrupted or tampered with");
  return plaintext;
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

test('Blob Round-Trip Preserves Bytes That Are Not Valid UTF-8', () => {
  const alice = generateKeyPair();
  const bob = generateKeyPair();
  const secret = deriveSharedSecret(bob.publicKey, alice.privateKey);

  // 0x00, 0xFF, a lone continuation byte, a truncated multi-byte sequence, and
  // the byte encoding of a surrogate — none of this survives a string round-trip.
  const header = Uint8Array.from([0x00, 0xff, 0x80, 0xc3, 0x28, 0xed, 0xa0, 0x80, 0xf8, 0xfe, 0xff, 0x00]);
  const binary = new Uint8Array(header.length + 4096);
  binary.set(header);
  binary.set(nacl.randomBytes(4096), header.length);

  // Guard the premise: routing these bytes through a string really does corrupt
  // them — a lossy decode substitutes U+FFFD and the bytes never come back.
  assert.notDeepEqual(decodeUTF8(new TextDecoder().decode(binary)), binary);

  const encrypted = encryptBlob(binary, secret);
  assert.equal(encrypted.length, nacl.secretbox.nonceLength + nacl.secretbox.overheadLength + binary.length);

  const decrypted = decryptBlob(encrypted, secret);
  assert.deepEqual(decrypted, binary);
});

test('Blob Round-Trip With A Group Key', () => {
  const groupKey = generateGroupKey();

  const binary = Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff]);
  const decrypted = decryptBlob(encryptBlob(binary, groupKey), groupKey);

  assert.deepEqual(decrypted, binary);
});

test('Zero-Byte Blob Round-Trips', () => {
  const alice = generateKeyPair();
  const bob = generateKeyPair();
  const secret = deriveSharedSecret(bob.publicKey, alice.privateKey);

  const empty = new Uint8Array(0);
  const encrypted = encryptBlob(empty, secret);

  // Nonce plus a Poly1305 tag, and nothing else.
  assert.equal(encrypted.length, nacl.secretbox.nonceLength + nacl.secretbox.overheadLength);

  const decrypted = decryptBlob(encrypted, secret);
  assert.equal(decrypted.length, 0);
});

test('Large Blob Round-Trips', () => {
  const alice = generateKeyPair();
  const bob = generateKeyPair();
  const secret = deriveSharedSecret(bob.publicKey, alice.privateKey);

  const size = 8 * 1024 * 1024;
  const binary = new Uint8Array(size);
  for (let i = 0; i < size; i++) binary[i] = i % 256;

  const encrypted = encryptBlob(binary, secret);
  const decrypted = decryptBlob(encrypted, secret);

  assert.equal(decrypted.length, size);
  assert.equal(Buffer.compare(Buffer.from(decrypted), Buffer.from(binary)), 0);
});

test('Flipping One Ciphertext Byte Fails Blob Decryption', () => {
  const alice = generateKeyPair();
  const bob = generateKeyPair();
  const secret = deriveSharedSecret(bob.publicKey, alice.privateKey);

  const binary = nacl.randomBytes(1024);
  const encrypted = encryptBlob(binary, secret);

  // A byte inside the ciphertext body, well past the nonce.
  const bodyFlip = encrypted.slice();
  bodyFlip[nacl.secretbox.nonceLength + 500] ^= 0x01;
  assert.throws(() => decryptBlob(bodyFlip, secret), /Decryption failed/);

  // A byte inside the prepended nonce.
  const nonceFlip = encrypted.slice();
  nonceFlip[3] ^= 0x01;
  assert.throws(() => decryptBlob(nonceFlip, secret), /Decryption failed/);

  // The authentication tag itself.
  const tagFlip = encrypted.slice();
  tagFlip[nacl.secretbox.nonceLength] ^= 0x01;
  assert.throws(() => decryptBlob(tagFlip, secret), /Decryption failed/);
});

test('Truncated Blob Ciphertext Fails Decryption', () => {
  const alice = generateKeyPair();
  const bob = generateKeyPair();
  const secret = deriveSharedSecret(bob.publicKey, alice.privateKey);

  const encrypted = encryptBlob(nacl.randomBytes(1024), secret);

  // One byte short.
  assert.throws(() => decryptBlob(encrypted.slice(0, encrypted.length - 1), secret), /Decryption failed/);
  // Cut inside the ciphertext body.
  assert.throws(() => decryptBlob(encrypted.slice(0, nacl.secretbox.nonceLength + 100), secret), /Decryption failed/);
  // Shorter than nonce + tag, and shorter than the nonce alone.
  assert.throws(() => decryptBlob(encrypted.slice(0, 30), secret), /Decryption failed/);
  assert.throws(() => decryptBlob(encrypted.slice(0, 10), secret), /Decryption failed/);
  assert.throws(() => decryptBlob(new Uint8Array(0), secret), /Decryption failed/);
});

test('Wrong Key Fails Blob Decryption', () => {
  const alice = generateKeyPair();
  const bob = generateKeyPair();
  const mallory = generateKeyPair();

  const secret = deriveSharedSecret(bob.publicKey, alice.privateKey);
  const wrongSecret = deriveSharedSecret(mallory.publicKey, alice.privateKey);
  assert.notEqual(wrongSecret, secret);

  const encrypted = encryptBlob(nacl.randomBytes(1024), secret);

  assert.throws(() => decryptBlob(encrypted, wrongSecret), /Decryption failed/);
  assert.throws(() => decryptBlob(encrypted, generateGroupKey()), /Decryption failed/);
});

test('Identical Blob Plaintext Encrypts To Different Ciphertext', () => {
  const alice = generateKeyPair();
  const bob = generateKeyPair();
  const secret = deriveSharedSecret(bob.publicKey, alice.privateKey);

  const binary = Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0xfd, 0xfe, 0xff]);
  const first = encryptBlob(binary, secret);
  const second = encryptBlob(binary, secret);

  // The nonce must be fresh per blob — reuse would break XSalsa20 outright.
  assert.notDeepEqual(first.slice(0, nacl.secretbox.nonceLength), second.slice(0, nacl.secretbox.nonceLength));
  assert.notDeepEqual(first.slice(nacl.secretbox.nonceLength), second.slice(nacl.secretbox.nonceLength));

  // Both still decrypt to the same plaintext.
  assert.deepEqual(decryptBlob(first, secret), binary);
  assert.deepEqual(decryptBlob(second, secret), binary);
});
