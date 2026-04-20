import { randomUUID } from "node:crypto";

export interface AgentMessageInit {
  content: string;
  senderId: string;
  senderPublicKey?: string;
  senderDid?: Record<string, unknown>;
  receiverId?: string;
  messageType?: string;
  messageId?: string;
  conversationId?: string;
  inReplyTo?: string;
  metadata?: Record<string, unknown>;
}

export class AgentMessage {
  readonly content: string;
  readonly senderId: string;
  readonly senderPublicKey?: string;
  readonly senderDid?: Record<string, unknown>;
  readonly receiverId?: string;
  readonly messageType: string;
  readonly messageId: string;
  readonly conversationId: string;
  readonly inReplyTo?: string;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: number;

  constructor(init: AgentMessageInit) {
    this.content = init.content;
    this.senderId = init.senderId;
    this.senderPublicKey = init.senderPublicKey;
    this.senderDid = init.senderDid;
    this.receiverId = init.receiverId;
    this.messageType = init.messageType ?? "query";
    this.messageId = init.messageId ?? randomUUID();
    this.conversationId = init.conversationId ?? randomUUID();
    this.inReplyTo = init.inReplyTo;
    this.metadata = init.metadata ?? {};
    this.timestamp = Date.now() / 1000;
  }

  toDict(): Record<string, unknown> {
    return {
      content: this.content,
      prompt: this.content,
      sender_id: this.senderId,
      sender_did: this.senderDid ?? null,
      sender_public_key: this.senderPublicKey ?? null,
      receiver_id: this.receiverId ?? null,
      message_type: this.messageType,
      message_id: this.messageId,
      conversation_id: this.conversationId,
      in_reply_to: this.inReplyTo ?? null,
      metadata: this.metadata,
      timestamp: this.timestamp,
    };
  }

  toJson(): string {
    return JSON.stringify(this.toDict());
  }

  static fromDict(data: Record<string, unknown>): AgentMessage {
    return new AgentMessage({
      content: (data.content as string) ?? (data.prompt as string) ?? "",
      senderId: (data.sender_id as string) ?? "unknown",
      senderPublicKey: data.sender_public_key as string | undefined,
      senderDid: (data.sender_did as Record<string, unknown>) ?? undefined,
      receiverId: data.receiver_id as string | undefined,
      messageType: (data.message_type as string) ?? "query",
      messageId: data.message_id as string | undefined,
      conversationId: data.conversation_id as string | undefined,
      inReplyTo: data.in_reply_to as string | undefined,
      metadata: (data.metadata as Record<string, unknown>) ?? {},
    });
  }

  static fromJson(jsonStr: string): AgentMessage {
    try {
      const data = JSON.parse(jsonStr);
      return AgentMessage.fromDict(data);
    } catch {
      return new AgentMessage({
        content: jsonStr,
        senderId: "unknown",
        messageType: "raw",
      });
    }
  }
}
