import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateKeypair } from "../src/identity";
import { canonicalJson } from "../src/entity-card";
import { sign } from "../src/identity";
import {
  registerEntity,
  getEntity,
  updateEntity,
  deleteEntity,
  searchEntities,
  getEntityCard,
  checkHandleAvailable,
  getEntityFqan,
  getRegistryInfo,
} from "../src/registry";

const REGISTRY = "https://registry.example.com";

function mockFetchOnce(body: unknown, status = 200): void {
  const response = new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  vi.mocked(globalThis.fetch).mockResolvedValueOnce(response);
}

function mockFetchErrorOnce(message: string): void {
  vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error(message));
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("registerEntity", () => {
  it("sends signed POST to /v1/entities and returns entity_id", async () => {
    const kp = generateKeypair();
    mockFetchOnce({ entity_id: "zns:abc123" });

    const id = await registerEntity({
      registryUrl: REGISTRY,
      keypair: kp,
      name: "test-agent",
      entityUrl: "https://agent.example.com",
      category: "general",
      tags: ["ai"],
      summary: "A test agent",
    });

    expect(id).toBe("zns:abc123");

    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${REGISTRY}/v1/entities`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent["name"]).toBe("test-agent");
    expect(sent["public_key"]).toBe(kp.publicKeyString);
    expect(typeof sent["signature"]).toBe("string");
    expect((sent["signature"] as string).startsWith("ed25519:")).toBe(true);
  });

  it("signature matches canonical JSON of payload fields in sorted order", async () => {
    const kp = generateKeypair();
    mockFetchOnce({ entity_id: "zns:xyz" });

    await registerEntity({
      registryUrl: REGISTRY,
      keypair: kp,
      name: "agent",
      entityUrl: "https://a.com",
      category: "finance",
      tags: ["x"],
      summary: "s",
    });

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;

    // Recompute expected signature
    const signable = canonicalJson({
      category: "finance",
      entity_url: "https://a.com",
      name: "agent",
      public_key: kp.publicKeyString,
      summary: "s",
      tags: ["x"],
    });
    const expectedSig = sign(kp.privateKeyBytes, new TextEncoder().encode(signable));

    expect(sent["signature"]).toBe(expectedSig);
  });

  it("includes entity_type in signable when provided", async () => {
    const kp = generateKeypair();
    mockFetchOnce({ entity_id: "zns:svc:abc" });

    await registerEntity({
      registryUrl: REGISTRY,
      keypair: kp,
      name: "my-service",
      entityUrl: "https://svc.example.com",
      entityType: "service",
    });

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;

    // entity_type must appear in both the body and the signature
    expect(sent["entity_type"]).toBe("service");

    const signable = canonicalJson({
      category: "general",
      entity_type: "service",
      entity_url: "https://svc.example.com",
      name: "my-service",
      public_key: kp.publicKeyString,
      summary: "",
      tags: [],
    });
    const expectedSig = sign(kp.privateKeyBytes, new TextEncoder().encode(signable));
    expect(sent["signature"]).toBe(expectedSig);
  });

  it("falls back to keypair-derived entity_id when registry omits it", async () => {
    const kp = generateKeypair();
    mockFetchOnce({ ok: true });

    const id = await registerEntity({
      registryUrl: REGISTRY,
      keypair: kp,
      name: "x",
      entityUrl: "https://x.com",
    });

    expect(id).toBe(kp.entityId);
  });

  it("throws on non-2xx response", async () => {
    const kp = generateKeypair();
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "conflict" }), { status: 409 })
    );

    await expect(
      registerEntity({ registryUrl: REGISTRY, keypair: kp, name: "x", entityUrl: "https://x.com" })
    ).rejects.toThrow("HTTP 409");
  });

  it("throws with context on network error", async () => {
    const kp = generateKeypair();
    mockFetchErrorOnce("ECONNREFUSED");

    await expect(
      registerEntity({ registryUrl: REGISTRY, keypair: kp, name: "x", entityUrl: "https://x.com" })
    ).rejects.toThrow("registerEntity: network error");
  });
});

describe("getEntity", () => {
  it("returns entity data on 200", async () => {
    const entity = { entity_id: "zns:abc", name: "bot" };
    mockFetchOnce(entity);

    const result = await getEntity(REGISTRY, "zns:abc");
    expect(result).toEqual(entity);

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    expect(url).toBe(`${REGISTRY}/v1/entities/zns%3Aabc`);
  });

  it("returns null on 404", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("{}", { status: 404 })
    );

    const result = await getEntity(REGISTRY, "zns:missing");
    expect(result).toBeNull();
  });

  it("throws on 500", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("internal error", { status: 500 })
    );

    await expect(getEntity(REGISTRY, "zns:x")).rejects.toThrow("HTTP 500");
  });

  it("throws with context on network error", async () => {
    mockFetchErrorOnce("DNS lookup failed");
    await expect(getEntity(REGISTRY, "zns:x")).rejects.toThrow("getEntity: network error");
  });
});

describe("updateEntity", () => {
  it("sends signed PUT with Bearer header over body bytes", async () => {
    const kp = generateKeypair();
    const updated = { entity_id: "zns:abc", name: "updated" };
    mockFetchOnce(updated);

    const result = await updateEntity({
      registryUrl: REGISTRY,
      entityId: "zns:abc",
      keypair: kp,
      fields: { name: "updated", summary: "new summary" },
    });

    expect(result).toEqual(updated);

    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${REGISTRY}/v1/entities/zns%3Aabc`);
    expect(init.method).toBe("PUT");

    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toMatch(/^Bearer ed25519:/);

    // Authorization sig must be over the exact body bytes sent
    const bodyBytes = init.body as Uint8Array;
    const expectedSig = sign(kp.privateKeyBytes, bodyBytes);
    expect(headers["Authorization"]).toBe(`Bearer ${expectedSig}`);
  });

  it("throws on non-2xx", async () => {
    const kp = generateKeypair();
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("not found", { status: 404 })
    );

    await expect(
      updateEntity({ registryUrl: REGISTRY, entityId: "zns:x", keypair: kp, fields: {} })
    ).rejects.toThrow("HTTP 404");
  });
});

describe("deleteEntity", () => {
  it("sends signed DELETE with Bearer header over entity_id bytes", async () => {
    const kp = generateKeypair();
    mockFetchOnce({ deleted: true });

    await deleteEntity({ registryUrl: REGISTRY, entityId: "zns:abc", keypair: kp });

    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${REGISTRY}/v1/entities/zns%3Aabc`);
    expect(init.method).toBe("DELETE");

    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toMatch(/^Bearer ed25519:/);

    // Signature must be over UTF-8 entity_id bytes
    const expectedSig = sign(kp.privateKeyBytes, new TextEncoder().encode("zns:abc"));
    expect(headers["Authorization"]).toBe(`Bearer ${expectedSig}`);
  });

  it("throws on non-2xx", async () => {
    const kp = generateKeypair();
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("forbidden", { status: 403 })
    );

    await expect(
      deleteEntity({ registryUrl: REGISTRY, entityId: "zns:x", keypair: kp })
    ).rejects.toThrow("HTTP 403");
  });

  it("throws with context on network error", async () => {
    const kp = generateKeypair();
    mockFetchErrorOnce("timeout");

    await expect(
      deleteEntity({ registryUrl: REGISTRY, entityId: "zns:x", keypair: kp })
    ).rejects.toThrow("deleteEntity: network error");
  });
});

describe("searchEntities", () => {
  it("sends POST to /v1/search and returns SearchResult shape", async () => {
    const results = {
      results: [{ entity_id: "zns:a", name: "a", score: 0.9 }],
      total_found: 1,
      offset: 0,
      has_more: false,
    };
    mockFetchOnce(results);

    const result = await searchEntities({
      registryUrl: REGISTRY,
      query: { query: "weather agent", max_results: 10 },
    });

    expect(result.total_found).toBe(1);
    expect(result.has_more).toBe(false);
    expect(result.results).toHaveLength(1);

    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${REGISTRY}/v1/search`);
    expect(init.method).toBe("POST");

    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent["query"]).toBe("weather agent");
    expect(sent["max_results"]).toBe(10);
  });

  it("throws on non-2xx", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("bad request", { status: 400 })
    );

    await expect(
      searchEntities({ registryUrl: REGISTRY, query: {} })
    ).rejects.toThrow("HTTP 400");
  });

  it("throws with context on network error", async () => {
    mockFetchErrorOnce("ETIMEDOUT");

    await expect(
      searchEntities({ registryUrl: REGISTRY, query: { query: "x" } })
    ).rejects.toThrow("searchEntities: network error");
  });
});

describe("getEntityCard", () => {
  it("returns card data on 200", async () => {
    const card = { entity_id: "zns:abc", name: "agent" };
    mockFetchOnce(card);

    const result = await getEntityCard(REGISTRY, "zns:abc");
    expect(result).toEqual(card);

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    expect(url).toBe(`${REGISTRY}/v1/entities/zns%3Aabc/card`);
  });

  it("returns null on 404", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response("{}", { status: 404 }));
    expect(await getEntityCard(REGISTRY, "zns:missing")).toBeNull();
  });
});

describe("checkHandleAvailable", () => {
  it("returns true when available", async () => {
    mockFetchOnce({ available: true, handle: "alice" });

    const result = await checkHandleAvailable(REGISTRY, "alice");
    expect(result).toBe(true);

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    expect(url).toBe(`${REGISTRY}/v1/handles/alice/available`);
  });

  it("returns false when taken", async () => {
    mockFetchOnce({ available: false, handle: "bob" });
    expect(await checkHandleAvailable(REGISTRY, "bob")).toBe(false);
  });

  it("throws on non-2xx", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("error", { status: 500 })
    );
    await expect(checkHandleAvailable(REGISTRY, "x")).rejects.toThrow("HTTP 500");
  });
});

describe("getEntityFqan", () => {
  it("returns fqan from first search result", async () => {
    mockFetchOnce({
      results: [{ entity_id: "zns:abc", fqan: "alice/my-agent@1.0", score: 1.0 }],
      total_found: 1,
      offset: 0,
      has_more: false,
    });

    const fqan = await getEntityFqan(REGISTRY, "zns:abc");
    expect(fqan).toBe("alice/my-agent@1.0");

    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${REGISTRY}/v1/search`);
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent["fqan"]).toBe("zns:abc");
    expect(sent["max_results"]).toBe(1);
  });

  it("returns null when no results", async () => {
    mockFetchOnce({ results: [], total_found: 0, offset: 0, has_more: false });
    expect(await getEntityFqan(REGISTRY, "zns:abc")).toBeNull();
  });

  it("returns null when result has no fqan field", async () => {
    mockFetchOnce({
      results: [{ entity_id: "zns:abc", score: 1.0 }],
      total_found: 1,
      offset: 0,
      has_more: false,
    });
    expect(await getEntityFqan(REGISTRY, "zns:abc")).toBeNull();
  });
});

describe("getRegistryInfo", () => {
  it("fetches /v1/info and returns metadata", async () => {
    const info = { registry_id: "zns:reg:1", version: "1.2.0", node_count: 3 };
    mockFetchOnce(info);

    const result = await getRegistryInfo(REGISTRY);
    expect(result).toEqual(info);

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    expect(url).toBe(`${REGISTRY}/v1/info`);
  });

  it("throws on non-2xx", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("unavailable", { status: 503 })
    );
    await expect(getRegistryInfo(REGISTRY)).rejects.toThrow("HTTP 503");
  });

  it("throws with context on network error", async () => {
    mockFetchErrorOnce("connection refused");
    await expect(getRegistryInfo(REGISTRY)).rejects.toThrow("getRegistryInfo: network error");
  });
});
