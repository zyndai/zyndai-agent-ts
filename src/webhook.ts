import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import express, { type Request, type Response, type Application } from "express";
import { AgentMessage } from "./message.js";
import type { Ed25519Keypair } from "./identity.js";
import type { AgentSearchResponse } from "./types.js";

export type MessageHandler = (message: AgentMessage) => void | Promise<void>;

export interface WebhookOptions {
  entityId: string;
  webhookHost?: string;
  webhookPort?: number;
  webhookUrl?: string;
  keypair?: Ed25519Keypair;
  agentCardBuilder?: () => Record<string, unknown>;
  price?: string;
  payToAddress?: string;
  messageHistoryLimit?: number;
}

// How long the sync handler waits for setResponse before returning 408.
const SYNC_TIMEOUT_MS = 30_000;
// Polling interval while waiting for a sync response.
const SYNC_POLL_INTERVAL_MS = 50;

export class WebhookCommunicationManager {
  private readonly entityId: string;
  private readonly host: string;
  private readonly desiredPort: number;
  private readonly explicitWebhookUrl: string | undefined;
  private readonly agentCardBuilder: (() => Record<string, unknown>) | undefined;
  private readonly messageHistoryLimit: number;

  private readonly handlers: MessageHandler[] = [];
  // messageId → resolved response string (set by setResponse)
  private readonly pendingResponses = new Map<string, string>();

  private app: Application;
  private server: Server | null = null;
  private _port = 0;
  private _isRunning = false;

  constructor(opts: WebhookOptions) {
    this.entityId = opts.entityId;
    this.host = opts.webhookHost ?? "0.0.0.0";
    this.desiredPort = opts.webhookPort ?? 5000;
    this.explicitWebhookUrl = opts.webhookUrl;
    this.agentCardBuilder = opts.agentCardBuilder;
    this.messageHistoryLimit = opts.messageHistoryLimit ?? 100;

    this.app = express();
    this.app.use(express.json());
    this.registerRoutes();
  }

  get port(): number {
    return this._port;
  }

  get webhookUrl(): string {
    if (this.explicitWebhookUrl) return this.explicitWebhookUrl;
    return `http://${this.host === "0.0.0.0" ? "127.0.0.1" : this.host}:${this._port}`;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  addMessageHandler(fn: MessageHandler): void {
    this.handlers.push(fn);
  }

  setResponse(messageId: string, response: string): void {
    this.pendingResponses.set(messageId, response);
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer(this.app);

      this.server.once("error", (err) => {
        reject(new Error(`WebhookCommunicationManager: server failed to start: ${err.message}`, { cause: err }));
      });

      this.server.listen(this.desiredPort, this.host, () => {
        const addr = this.server!.address();
        // addr is AddressInfo when TCP, string when Unix socket — we only use TCP.
        if (addr === null || typeof addr === "string") {
          reject(new Error("WebhookCommunicationManager: unexpected server address type"));
          return;
        }
        this._port = addr.port;
        this._isRunning = true;
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        if (err) {
          reject(new Error(`WebhookCommunicationManager: error closing server: ${err.message}`, { cause: err }));
          return;
        }
        this._isRunning = false;
        resolve();
      });
    });
  }

  // Sends an AgentMessage to targetUrl and returns the response body as a string.
  async sendMessage(
    targetUrl: string,
    content: string,
    opts?: { receiverId?: string; messageType?: string; metadata?: Record<string, unknown> }
  ): Promise<string> {
    const message = new AgentMessage({
      content,
      senderId: this.entityId,
      receiverId: opts?.receiverId,
      messageType: opts?.messageType ?? "query",
      metadata: opts?.metadata,
    });

    let resp: globalThis.Response;
    try {
      resp = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: message.toJson(),
      });
    } catch (err) {
      throw new Error(`sendMessage: network error to ${targetUrl}: ${String(err)}`, { cause: err });
    }

    const text = await resp.text().catch(() => "(unreadable)");
    if (!resp.ok) {
      throw new Error(`sendMessage: HTTP ${resp.status} from ${targetUrl}: ${text}`);
    }
    return text;
  }

  // Resolves the invoke URL for an agent: prefers card endpoints.invoke, falls back to entity_url/webhook.
  connectAgent(agent: AgentSearchResponse): string {
    const card = agent.card as Record<string, unknown> | undefined;
    const endpoints = card?.["endpoints"] as Record<string, string> | undefined;
    if (endpoints?.["invoke"]) return endpoints["invoke"];
    return `${agent.entity_url.replace(/\/+$/, "")}/webhook/sync`;
  }

  private registerRoutes(): void {
    this.app.get("/health", (_req: Request, res: Response) => {
      res.json({ status: "ok", entity_id: this.entityId, timestamp: new Date().toISOString() });
    });

    this.app.get("/.well-known/agent.json", (_req: Request, res: Response) => {
      if (!this.agentCardBuilder) {
        res.status(404).json({ error: "agent card not configured" });
        return;
      }
      res.json(this.agentCardBuilder());
    });

    this.app.post("/webhook", (req: Request, res: Response) => {
      if (!isJsonContentType(req)) {
        res.status(400).json({ error: "Content-Type must be application/json" });
        return;
      }

      const message = AgentMessage.fromDict(req.body as Record<string, unknown>);
      const messageId = message.messageId || randomUUID();

      // Fire handlers without awaiting — async message delivery.
      void this.fireHandlers(message);

      res.json({ status: "received", message_id: messageId });
    });

    this.app.post("/webhook/sync", async (req: Request, res: Response) => {
      if (!isJsonContentType(req)) {
        res.status(400).json({ error: "Content-Type must be application/json" });
        return;
      }

      const message = AgentMessage.fromDict(req.body as Record<string, unknown>);
      const messageId = message.messageId;

      // Fire handlers synchronously so they can call setResponse before polling starts.
      await this.fireHandlers(message);

      const response = await this.pollForResponse(messageId);

      if (response === null) {
        res.status(408).json({ error: "timeout waiting for response", message_id: messageId });
        return;
      }

      this.pendingResponses.delete(messageId);
      res.json({ status: "success", message_id: messageId, response });
    });
  }

  private async fireHandlers(message: AgentMessage): Promise<void> {
    for (const handler of this.handlers) {
      try {
        await handler(message);
      } catch (err) {
        // Log but don't propagate — a failing handler must not crash the server or
        // block other handlers. Callers should instrument their handlers separately.
        console.error(`WebhookCommunicationManager: handler threw for message ${message.messageId}:`, err);
      }
    }
  }

  // Polls pendingResponses every SYNC_POLL_INTERVAL_MS for up to SYNC_TIMEOUT_MS.
  // Returns the response string, or null on timeout.
  private pollForResponse(messageId: string): Promise<string | null> {
    return new Promise((resolve) => {
      const deadline = Date.now() + SYNC_TIMEOUT_MS;

      const tick = (): void => {
        const response = this.pendingResponses.get(messageId);
        if (response !== undefined) {
          resolve(response);
          return;
        }
        if (Date.now() >= deadline) {
          resolve(null);
          return;
        }
        setTimeout(tick, SYNC_POLL_INTERVAL_MS);
      };

      tick();
    });
  }
}

function isJsonContentType(req: Request): boolean {
  const ct = req.headers["content-type"] ?? "";
  // application/json or application/json; charset=utf-8
  return ct.includes("application/json");
}
