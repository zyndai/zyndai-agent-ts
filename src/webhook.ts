import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import express, { type Request, type Response, type Application } from "express";
import { AgentMessage } from "./message.js";
import type { Ed25519Keypair } from "./identity.js";
import type { AgentSearchResponse } from "./types.js";

export type MessageHandler = (message: AgentMessage, topic: string | null) => void | Promise<void>;

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
  // messageId -> resolved response string (set by setResponse)
  private readonly pendingResponses = new Map<string, string>();
  private readonly receivedMessages: Array<{ message: AgentMessage; receivedAt: number }> = [];
  private readonly messageHistory: Array<{ message: AgentMessage; receivedAt: number }> = [];

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

  registerHandler(fn: MessageHandler): void {
    this.addMessageHandler(fn);
  }

  setResponse(messageId: string, response: string): void {
    this.pendingResponses.set(messageId, response);
  }

  async start(): Promise<void> {
    const MAX_PORT_RETRIES = 10;

    for (let attempt = 0; attempt < MAX_PORT_RETRIES; attempt++) {
      const port = this.desiredPort + attempt;
      try {
        await this.tryListen(port);
        return;
      } catch (err) {
        const isAddrInUse =
          err instanceof Error &&
          "code" in (err.cause as Record<string, unknown> ?? {}) &&
          (err.cause as Record<string, unknown>).code === "EADDRINUSE";
        if (isAddrInUse && attempt < MAX_PORT_RETRIES - 1) {
          continue;
        }
        throw err;
      }
    }
  }

  private tryListen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer(this.app);

      server.once("error", (err: NodeJS.ErrnoException) => {
        reject(new Error(`WebhookCommunicationManager: server failed to start on port ${port}: ${err.message}`, { cause: err }));
      });

      server.listen(port, this.host, () => {
        const addr = server.address();
        if (addr === null || typeof addr === "string") {
          reject(new Error("WebhookCommunicationManager: unexpected server address type"));
          return;
        }
        this.server = server;
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

  readMessages(): string {
    if (!this._isRunning) return "Webhook server not running.";
    if (this.receivedMessages.length === 0) return "No new messages in the queue.";

    const formatted = this.receivedMessages.map((item) => {
      const m = item.message;
      return `From: ${m.senderId}\nType: ${m.messageType}\nContent: ${m.content}`;
    });

    const output = "Messages received:\n\n" + formatted.join("\n---\n");
    this.receivedMessages.length = 0;
    return output;
  }

  getConnectionStatus(): {
    entity_id: string;
    is_running: boolean;
    webhook_url: string;
    webhook_port: number;
    pending_messages: number;
    message_history_count: number;
  } {
    return {
      entity_id: this.entityId,
      is_running: this._isRunning,
      webhook_url: this.webhookUrl,
      webhook_port: this._port,
      pending_messages: this.receivedMessages.length,
      message_history_count: this.messageHistory.length,
    };
  }

  getMessageHistory(limit?: number): Array<{ message: AgentMessage; receivedAt: number }> {
    if (limit === undefined) return [...this.messageHistory];
    return this.messageHistory.slice(-limit);
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

      this.storeMessage(message);

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

      this.storeMessage(message);

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

  private storeMessage(message: AgentMessage): void {
    const entry = { message, receivedAt: Date.now() / 1000 };
    this.receivedMessages.push(entry);
    this.messageHistory.push(entry);
    if (this.messageHistory.length > this.messageHistoryLimit) {
      this.messageHistory.splice(0, this.messageHistory.length - this.messageHistoryLimit);
    }
  }

  private async fireHandlers(message: AgentMessage): Promise<void> {
    for (const handler of this.handlers) {
      try {
        await handler(message, null);
      } catch (err) {
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
