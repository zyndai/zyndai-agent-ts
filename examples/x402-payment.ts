import { X402PaymentProcessor, generateKeypair } from "../src/index.js";

const kp = generateKeypair();
const processor = new X402PaymentProcessor({
  ed25519PrivateKeyBytes: kp.privateKeyBytes,
});

console.log("ETH Address:", processor.address);
console.log("Entity ID:", kp.entityId);
console.log("Public Key:", kp.publicKeyString);
