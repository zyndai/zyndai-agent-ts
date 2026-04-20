import { describe, it, expect } from "vitest";
import { AgentMessage } from "../src/message";

describe("AgentMessage", () => {
  it("auto-generates message_id and conversation_id", () => {
    const msg = new AgentMessage({ content: "hello", senderId: "agent-1" });
    expect(msg.messageId).toBeTruthy();
    expect(msg.conversationId).toBeTruthy();
    expect(msg.timestamp).toBeGreaterThan(0);
  });

  it("round-trips through toDict/fromDict", () => {
    const msg = new AgentMessage({
      content: "test", senderId: "a", receiverId: "b",
      messageType: "response", senderPublicKey: "ed25519:abc123",
      metadata: { key: "value" },
    });
    const dict = msg.toDict();
    const restored = AgentMessage.fromDict(dict);
    expect(restored.content).toBe("test");
    expect(restored.senderId).toBe("a");
    expect(restored.receiverId).toBe("b");
    expect(restored.messageType).toBe("response");
    expect(restored.senderPublicKey).toBe("ed25519:abc123");
    expect(restored.metadata).toEqual({ key: "value" });
  });

  it("round-trips through toJson/fromJson", () => {
    const msg = new AgentMessage({ content: "json test", senderId: "x" });
    const json = msg.toJson();
    const restored = AgentMessage.fromJson(json);
    expect(restored.content).toBe("json test");
    expect(restored.senderId).toBe("x");
  });

  it("fromDict reads prompt field as content fallback", () => {
    const msg = AgentMessage.fromDict({ prompt: "from prompt", sender_id: "s" });
    expect(msg.content).toBe("from prompt");
  });

  it("fromJson handles invalid JSON as raw message", () => {
    const msg = AgentMessage.fromJson("not json at all");
    expect(msg.content).toBe("not json at all");
    expect(msg.senderId).toBe("unknown");
    expect(msg.messageType).toBe("raw");
  });

  it("toDict includes both content and prompt fields", () => {
    const msg = new AgentMessage({ content: "hello", senderId: "a" });
    const dict = msg.toDict();
    expect(dict.content).toBe("hello");
    expect(dict.prompt).toBe("hello");
  });
});
