import { canonicalJson } from "./entity-card";
import { Ed25519Keypair, sign } from "./identity";

export interface RegisterEntityOpts {
  registryUrl: string;
  keypair: Ed25519Keypair;
  name: string;
  entityUrl: string;
  category?: string;
  tags?: string[];
  summary?: string;
  capabilitySummary?: Record<string, unknown>;
  developerId?: string;
  developerProof?: Record<string, unknown>;
  entityName?: string;
  version?: string;
  entityType?: string;
  serviceEndpoint?: string;
  openapiUrl?: string;
  entityPricing?: Record<string, unknown>;
}

/**
 * Register an agent or service on the registry.
 *
 * Builds a canonical signable payload (sorted keys, no whitespace) matching
 * the Go backend's json.Marshal byte order, signs it with Ed25519, then
 * POSTs to /v1/entities.
 *
 * Returns the entity_id assigned by the registry, falling back to the
 * keypair-derived ID if the registry response omits it.
 */
export async function registerEntity(opts: RegisterEntityOpts): Promise<string> {
  const {
    registryUrl,
    keypair,
    name,
    entityUrl,
    category = "general",
    tags = [],
    summary = "",
    capabilitySummary,
    developerId,
    developerProof,
    entityName,
    version,
    entityType,
    serviceEndpoint,
    openapiUrl,
    entityPricing,
  } = opts;

  // Signable payload must match Go's json.Marshal: sorted keys, no whitespace,
  // raw UTF-8 (not \uXXXX escapes). canonicalJson sorts keys alphabetically.
  const signable: Record<string, unknown> = {
    category,
    entity_url: entityUrl,
    name,
    public_key: keypair.publicKeyString,
    summary,
    tags,
  };
  if (entityType) signable["entity_type"] = entityType;

  const signableBytes = new TextEncoder().encode(canonicalJson(signable));
  const signature = sign(keypair.privateKeyBytes, signableBytes);

  const body: Record<string, unknown> = {
    category,
    entity_url: entityUrl,
    name,
    public_key: keypair.publicKeyString,
    signature,
    summary,
    tags,
  };

  if (entityType) body["entity_type"] = entityType;
  if (serviceEndpoint) body["service_endpoint"] = serviceEndpoint;
  if (openapiUrl) body["openapi_url"] = openapiUrl;
  if (entityPricing) body["entity_pricing"] = entityPricing;
  if (capabilitySummary) body["capability_summary"] = capabilitySummary;
  if (developerId) body["developer_id"] = developerId;
  if (developerProof) body["developer_proof"] = developerProof;
  if (entityName) body["entity_name"] = entityName;
  if (version) body["version"] = version;

  const resp = await fetch(`${registryUrl}/v1/entities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `Failed to register on registry. Status: ${resp.status}, Response: ${text}`
    );
  }

  const data = (await resp.json()) as { entity_id?: string };
  return data.entity_id ?? keypair.entityId;
}
