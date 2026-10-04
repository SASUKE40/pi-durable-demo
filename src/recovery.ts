import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { DemoEvent } from "./triage.ts";

export function runWorker(db: string, options: {
  crash?: boolean;
  onEvent?: (event: DemoEvent) => void;
  timeoutMs?: number;
} = {}): Promise<DemoEvent[]> {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(new URL("./worker.ts", import.meta.url)),
      ["--db", db, ...(options.crash ? ["--pause-after-commit"] : [])],
      { execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"] });
    const events: DemoEvent[] = [];
    let diagnostics = "";
    let killedAtCheckpoint = false;
    let timedOut = false;
    child.stdout?.on("data", (chunk) => { diagnostics += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { diagnostics += chunk.toString(); });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs ?? 20_000);
    child.on("message", (message) => {
      const event = message as DemoEvent;
      events.push(event);
      options.onEvent?.(event);
      if (options.crash && event.type === "crash-ready") {
        killedAtCheckpoint = child.kill("SIGKILL");
      }
    });
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) return reject(new Error(`Worker timed out. ${diagnostics}`));
      if (options.crash ? killedAtCheckpoint && signal === "SIGKILL" : code === 0) {
        resolve(events);
      } else {
        reject(new Error(`Worker exited unexpectedly (code=${code}, signal=${signal}). ${diagnostics}`));
      }
    });
  });
}

export function verifyRecovery(first: DemoEvent[], resumed: DemoEvent[], retried: DemoEvent[]) {
  const original = first.find((event) => event.type === "submitted");
  const done = resumed.find((event) => event.type === "done");
  const again = retried.find((event) => event.type === "done");
  assert(original && done && again, "Each process must find the job.");
  assert(first.some((event) => event.type === "crash-ready"), "First worker reached the crash boundary.");
  assert(!first.some((event) => event.type === "done"), "First worker never finished the job.");
  assert.equal(done.id, original.id, "Resume must reuse the submission.");
  assert.equal(again.id, original.id, "A completed retry must reuse the submission.");
  assert.equal(done.conversationId, original.conversationId);
  assert.equal(again.conversationId, original.conversationId);
  const tools = (events: DemoEvent[]) => events.filter((event) => event.type === "tool");
  assert.deepEqual(tools(first).map((event) => event.name), ["read_issue", "save_report"]);
  assert.deepEqual(tools(resumed).map((event) => event.name), ["save_report"], "Only the interrupted tool should replay.");
  assert.equal(tools(resumed)[0]?.taskId, tools(first)[1]?.taskId, "Replayed tool must keep its task ID.");
  assert.equal(tools(retried).length, 0, "A completed retry should run no tools.");
  assert(resumed.some((event) => event.type === "report" && !event.inserted), "Replay should find the existing report.");
  assert.equal(done.reports?.writes, 1, "Report effect must happen once.");
  assert.equal(done.reports.items.length, 1);
  assert.deepEqual(again.reports, done.reports);
  assert(done.answer, "The recovered job must produce an answer.");
  assert.equal(again.answer, done.answer);
  return done;
}
