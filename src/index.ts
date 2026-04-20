export {
  Ed25519Keypair,
  generateKeypair,
  keypairFromPrivateBytes,
  loadKeypair,
  loadKeypairWithMetadata,
  saveKeypair,
  generateEntityId,
  generateDeveloperId,
  sign,
  verify,
  deriveAgentKeypair,
  createDerivationProof,
  verifyDerivationProof,
} from "./identity.js";

export { AgentMessage } from "./message.js";
export type { AgentMessageInit } from "./message.js";

export {
  AgentFramework,
  ZyndBaseConfigSchema,
  AgentConfigSchema,
  ServiceConfigSchema,
} from "./types.js";
export type {
  ZyndBaseConfig,
  AgentConfig,
  ServiceConfig,
  AgentSearchResponse,
  SearchRequest,
  SearchResult,
  EntityEndpoints,
  EntityCardPricing,
  EntityCard,
  AgentConfigFile,
  DerivationProof,
} from "./types.js";

export {
  buildEndpoints,
  buildEntityCard,
  signEntityCard,
} from "./entity-card.js";

export {
  loadEntityCard,
  resolveKeypair,
  buildRuntimeCard,
  computeCardHash,
  resolveCardFromConfig,
  loadDerivationMetadata,
} from "./entity-card-loader.js";

export * as DNSRegistryClient from "./registry.js";

export { SearchAndDiscoveryManager } from "./search.js";

export { X402PaymentProcessor } from "./payment.js";

export { ConfigManager, buildEntityUrl } from "./config-manager.js";

export { WebhookCommunicationManager } from "./webhook.js";

export { ZyndBase } from "./base.js";

export { ZyndAIAgent } from "./agent.js";

export { ZyndService } from "./service.js";

export { encryptMessage, decryptMessage } from "./crypto.js";
export type { EncryptedMessage } from "./crypto.js";

export const VERSION = "0.1.0";
