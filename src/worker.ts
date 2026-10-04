import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { AssistantEntry, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { scriptedProvider } from "./scripted-model.ts";
import { Reports, triageExtension, type DemoEvent } from "./triage.ts";

async function main() {
  const { values } = parseArgs({ options: {
    db: { type: "string", default: ".demo/manual.sqlite" },
    live: { type: "boolean", default: false },
    model: { type: "string" },
    "pause-after-commit": { type: "boolean", default: false },
  } });
  if (values["pause-after-commit"] && !process.send) {
    throw new Error("--pause-after-commit is for the demo supervisor. Use npm run demo.");
  }
  if (values.live && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("Live mode requires ANTHROPIC_API_KEY. Omit --live for the offline demo.");
  }
  const emit = (event: DemoEvent) => {
    if (process.send) process.send(event);
    else console.log(JSON.stringify(event, null, 2));
  };
  const models = createModels();
  if (values.live) {
    const { anthropicProvider } = await import("@earendil-works/pi-ai/providers/anthropic");
    models.setProvider(anthropicProvider());
  } else {
    models.setProvider(scriptedProvider());
  }
  const selection = values.live
    ? { provider: "anthropic", modelId: values.model ?? "claude-haiku-4-5" }
    : { provider: "demo", modelId: "scripted-triage" };
  if (!models.getModel(selection.provider, selection.modelId)) {
    throw new Error(`Unknown model ${selection.modelId}; pass --model with an installed provider catalog ID.`);
  }
  const registry = createRegistry();
  registry.install(triageExtension(emit, values["pause-after-commit"]));
  const db = resolve(values.db);
  await mkdir(dirname(db), { recursive: true });
  const harness = await Harness.open(await openNodeSqliteStorage(db), {
    models, registry, settings: { retry: { maxRetries: 0 } },
  }, context);
  try {
    const root = await harness.root(context, { agent: {
      model: selection,
      instructions: "Triage issue #42. First call read_issue, then call save_report exactly once with your diagnosis and recommended fix. Finally give a short answer. Do not claim the code was changed.",
    } });
    const existing = await root.agent(context);
    if (existing.model?.provider !== selection.provider || existing.model?.modelId !== selection.modelId) {
      throw new Error("This database uses a different model. Choose a new --db path for this mode/model.");
    }
    harness.resume();
    // A fixed ID identifies this one logical job across process/client retries.
    const submission = await root.submit({
      type: "input", content: "Investigate the flaky login test in issue #42 and save a triage report.",
      requestId: "triage-issue-42-v1",
    }, context);
    emit({ type: "submitted", id: submission.id, conversationId: root.id });
    const settled = await submission.wait(context);
    if (settled.status !== "done" || settled.type !== "input") {
      throw new Error(`Job did not finish: ${JSON.stringify(settled)}`);
    }
    const entry = await root.commit((tx) => tx.entry(AssistantEntry, settled.answer), context);
    const answer = entry?.model?.flatMap((message) => message.role === "assistant"
      ? message.content.flatMap((part) => part.type === "text" ? [part.text] : []) : []).join("\n");
    const reports = await harness.snapshot(Reports, root.id, context);
    emit({ type: "done", id: submission.id, conversationId: root.id, answer, reports });
  } finally {
    await harness.close(context);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => { if (process.connected) process.disconnect?.(); });
