import { ZyndAIAgent, type AgentConfig } from "../src/index.js";

const config: AgentConfig = {
  name: "Echo Agent",
  description: "Echoes back whatever you send",
  capabilities: { text: ["echo"] },
  registryUrl: "https://registry.zynd.ai",
  webhookPort: 5001,
  price: "$0.01",
};

const agent = new ZyndAIAgent(config);

agent.setCustomAgent((input: string) => {
  return `Echo: ${input}`;
});

agent.webhook.addMessageHandler((msg) => {
  const result = `Echo: ${msg.content}`;
  agent.webhook.setResponse(msg.messageId, result);
});

await agent.start();
console.log("Agent running. Press Ctrl+C to stop.");
