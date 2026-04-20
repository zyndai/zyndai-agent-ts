import { x25519, edwardsToMontgomeryPub, edwardsToMontgomeryPriv } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { gcm } from "@noble/ciphers/aes";
import { randomBytes } from "@noble/ciphers/webcrypto";
import type { Ed25519Keypair } from "./identity";

// HKDF info string shared with the Python SDK (agdns:encryption:v1)
const HKDF_INFO = new TextEncoder().encode("agdns:encryption:v1");

export interface EncryptedMessage {
  ephemeral_public_key: string;
  nonce: string;
  encrypted_data: string;
  algorithm: "X25519-AES256-GCM";
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function deriveKey(sharedSecret: Uint8Array): Uint8Array {
  // no salt per Python SDK (salt=None → zero-length salt in HKDF)
  return hkdf(sha256, sharedSecret, undefined, HKDF_INFO, 32);
}

/**
 * Encrypts a UTF-8 message for the given recipient Ed25519 public key.
 *
 * Uses an ephemeral X25519 keypair so each ciphertext is unlinkable.
 * Compatible with Python SDK's encrypt_message_x25519().
 */
export function encryptMessage(message: string, recipientPubB64: string): EncryptedMessage {
  const recipientEdPub = fromBase64(recipientPubB64);
  if (recipientEdPub.length !== 32) {
    throw new Error(`encryptMessage: recipient public key must be 32 bytes, got ${recipientEdPub.length}`);
  }

  // Convert recipient Ed25519 public key → X25519 (birational map, RFC 7748)
  const recipientMontPub = edwardsToMontgomeryPub(recipientEdPub);

  // Ephemeral X25519 keypair
  const ephemeralPriv = x25519.utils.randomPrivateKey();
  const ephemeralPub = x25519.getPublicKey(ephemeralPriv);

  // ECDH
  const sharedSecret = x25519.getSharedSecret(ephemeralPriv, recipientMontPub);

  const key = deriveKey(sharedSecret);
  const nonce = randomBytes(12);

  const plaintext = new TextEncoder().encode(message);
  // gcm returns ciphertext || 16-byte auth tag concatenated
  const cipherstream = gcm(key, nonce);
  const encrypted = cipherstream.encrypt(plaintext);

  return {
    ephemeral_public_key: toBase64(ephemeralPub),
    nonce: toBase64(nonce),
    encrypted_data: toBase64(encrypted),
    algorithm: "X25519-AES256-GCM",
  };
}

/**
 * Decrypts an EncryptedMessage produced by encryptMessage() or the Python SDK.
 *
 * Throws if the keypair is wrong or the ciphertext is tampered (GCM auth failure).
 */
export function decryptMessage(encrypted: EncryptedMessage, keypair: Ed25519Keypair): string {
  if (encrypted.algorithm !== "X25519-AES256-GCM") {
    throw new Error(`decryptMessage: unsupported algorithm "${encrypted.algorithm}"`);
  }

  // Convert our Ed25519 seed → X25519 scalar (SHA-512 + clamp)
  const ourMontPriv = edwardsToMontgomeryPriv(keypair.privateKeyBytes);

  const ephemeralPub = fromBase64(encrypted.ephemeral_public_key);
  if (ephemeralPub.length !== 32) {
    throw new Error(`decryptMessage: ephemeral_public_key must be 32 bytes, got ${ephemeralPub.length}`);
  }

  const sharedSecret = x25519.getSharedSecret(ourMontPriv, ephemeralPub);
  const key = deriveKey(sharedSecret);

  const nonce = fromBase64(encrypted.nonce);
  const ciphertext = fromBase64(encrypted.encrypted_data);

  const cipherstream = gcm(key, nonce);
  // decrypt throws on auth tag mismatch — let it propagate with context
  let plaintext: Uint8Array;
  try {
    plaintext = cipherstream.decrypt(ciphertext);
  } catch (e) {
    throw new Error(`decryptMessage: decryption failed (wrong key or tampered ciphertext)`, { cause: e });
  }

  return new TextDecoder().decode(plaintext);
}
