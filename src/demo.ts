import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve, join } from "node:path";
import { runWorker, verifyRecovery } from "./recovery.ts";
import type { DemoEvent } from "./triage.ts";

function show(event: DemoEvent) {
  if (event.type === "submitted") console.log(`  Conversation ${event.conversationId}, submission ${event.id}`);
  if (event.type === "tool") console.log(`  → ${event.name}${event.taskId ? ` (task ${event.taskId})` : ""}`);
  if (event.type === "report") console.log(event.inserted
    ? "  ✓ Report committed to SQLite" : "  ✓ Existing report found; no duplicate write");
  if (event.type === "crash-ready") console.log("  ✕ Killing worker with SIGKILL before the tool returns");
}

async function main() {
  await mkdir(resolve(".demo"), { recursive: true });
  const directory = await mkdtemp(resolve(".demo/run-"));
  const db = join(directory, "agent.sqlite");
  console.log("\nPI DURABLE · crash → resume → retry");
  console.log("Real harness + SQLite. Scripted model, local fixture, no API key.\n");
  console.log("1. Start the job and crash after its report is committed.");
  const first = await runWorker(db, { crash: true, onEvent: show });
  console.log("\n2. Open the same database in a new process and resume.");
  const resumed = await runWorker(db, { onEvent: show });
  console.log("\n3. Retry the same requestId in a third process.");
  const retried = await runWorker(db, { onEvent: show });
  const done = verifyRecovery(first, resumed, retried);
  console.log("  ✓ Returned the stored answer without running any tools");
  console.log(`\n${done.answer}`);
  console.log("\nPASS · same submission · interrupted tool replayed · one report write");
  console.log(`Database kept at: ${db}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
