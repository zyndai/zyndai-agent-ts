import { describe, it, expect } from "vitest";
import { encryptMessage, decryptMessage } from "../src/crypto";
import { generateKeypair } from "../src/identity";

describe("encryptMessage / decryptMessage", () => {
  it("round-trips an ASCII message", () => {
    const kp = generateKeypair();
    const encrypted = encryptMessage("hello world", kp.publicKeyB64);
    expect(encrypted.algorithm).toBe("X25519-AES256-GCM");
    const plaintext = decryptMessage(encrypted, kp);
    expect(plaintext).toBe("hello world");
  });

  it("round-trips unicode content (emoji, CJK, em dash)", () => {
    const kp = generateKeypair();
    const msg = "Hello 🌍 — 你好世界 — こんにちは";
    const plaintext = decryptMessage(encryptMessage(msg, kp.publicKeyB64), kp);
    expect(plaintext).toBe(msg);
  });

  it("produces different ciphertexts for the same plaintext (ephemeral keypair)", () => {
    const kp = generateKeypair();
    const msg = "same message";
    const a = encryptMessage(msg, kp.publicKeyB64);
    const b = encryptMessage(msg, kp.publicKeyB64);
    expect(a.ephemeral_public_key).not.toBe(b.ephemeral_public_key);
    expect(a.encrypted_data).not.toBe(b.encrypted_data);
  });

  it("throws when decrypting with the wrong keypair", () => {
    const sender = generateKeypair();
    const wrongRecipient = generateKeypair();
    const encrypted = encryptMessage("secret", sender.publicKeyB64);
    // GCM auth tag mismatch must cause a throw
    expect(() => decryptMessage(encrypted, wrongRecipient)).toThrow();
  });

  it("throws for an unsupported algorithm field", () => {
    const kp = generateKeypair();
    const bad = {
      ephemeral_public_key: "",
      nonce: "",
      encrypted_data: "",
      algorithm: "UNSUPPORTED" as "X25519-AES256-GCM",
    };
    expect(() => decryptMessage(bad, kp)).toThrow(/unsupported algorithm/);
  });

  it("throws when the recipient public key is the wrong length", () => {
    expect(() => encryptMessage("hi", Buffer.from(new Uint8Array(16)).toString("base64"))).toThrow(
      /must be 32 bytes/
    );
  });
});
