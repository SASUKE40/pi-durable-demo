import { randomUUID } from "node:crypto";
import type { AssistantMessage, Model, ProviderStreams } from "@earendil-works/pi-ai";
import { createProvider } from "@earendil-works/pi-ai/models";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";

// Only the model is scripted. Conversations, tool tasks, commits, and recovery
// all use the published pi-durable implementation.
const model: Model<"openai-completions"> = {
  id: "scripted-triage", name: "Scripted triage (offline)",
  provider: "demo", api: "openai-completions", baseUrl: "http://unused.invalid",
  reasoning: false, input: ["text"], contextWindow: 128_000, maxTokens: 2048,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

const stream: ProviderStreams["stream"] = (_model, context) => {
  const output = createAssistantMessageEventStream();
  const results = context.messages.filter((message) => message.role === "toolResult");
  const saved = results.find((result) => result.toolName === "save_report" && !result.isError);
  const read = results.find((result) => result.toolName === "read_issue" && !result.isError);
  const content: AssistantMessage["content"] = saved
    ? [{ type: "text", text: "Issue #42 is a bug: the login test races the session write. Await session persistence before asserting. The triage report is saved." }]
    : [{
        type: "toolCall", id: randomUUID(), name: read ? "save_report" : "read_issue",
        arguments: read
          ? { summary: "Bug: login test races asynchronous session persistence.", recommendation: "Await the session write before asserting that login succeeded." }
          : {},
      }];
  const message: AssistantMessage = {
    role: "assistant", content, api: model.api, provider: model.provider, model: model.id,
    stopReason: saved ? "stop" : "toolUse", timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  output.push({ type: "start", partial: { ...message, content: [] } });
  output.push({ type: "done", reason: saved ? "stop" : "toolUse", message });
  return output;
};

export const scriptedProvider = () => createProvider({
  id: "demo", models: [model],
  auth: { apiKey: { name: "Offline demo", resolve: async () => ({ auth: {} }) } },
  api: { stream, streamSimple: stream },
});
