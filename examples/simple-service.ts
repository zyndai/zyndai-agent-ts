import { ZyndService, type ServiceConfig } from "../src/index.js";

const config: ServiceConfig = {
  name: "Text Transform Service",
  description: "Transforms text to uppercase",
  capabilities: { text: ["transform"] },
  registryUrl: "https://registry.zynd.ai",
  webhookPort: 5002,
};

const service = new ZyndService(config);

service.setHandler((input: string) => {
  return input.toUpperCase();
});

await service.start();
console.log("Service running. Press Ctrl+C to stop.");
