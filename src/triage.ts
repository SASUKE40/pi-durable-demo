import { setTimeout as delay } from "node:timers/promises";
import { Type } from "@earendil-works/pi-ai";
import { defineDoc, defineExtension, defineTool } from "@earendil-works/pi-durable";

export type Report = { taskId: number; summary: string; recommendation: string };
export const Reports = defineDoc<{ items: Report[]; writes: number }>({
  kind: "demo.reports", version: 1, scope: "conversation",
  history: "rewindable", fork: "asOf", initial: () => ({ items: [], writes: 0 }),
});

export type DemoEvent =
  | { type: "tool"; name: string; taskId?: number }
  | { type: "report"; inserted: boolean; taskId: number }
  | { type: "crash-ready" }
  | { type: "submitted"; id: number; conversationId: number }
  | { type: "done"; id: number; conversationId: number; answer: string | undefined;
      reports: { items: readonly Report[]; writes: number } | undefined };

export function triageExtension(emit: (event: DemoEvent) => void, pauseAfterCommit: boolean) {
  return defineExtension({
    name: "issue-triage",
    tools: [
      defineTool({
        name: "read_issue", description: "Read the issue and its test logs.",
        parameters: Type.Object({}), replay: "safe",
        execute: async () => {
          emit({ type: "tool", name: "read_issue" });
          return { content: [{ type: "text", text: JSON.stringify({
            id: 42, title: "Login test fails intermittently",
            logs: ["12:00:00.010 login returned 200", "12:00:00.011 assertion: session missing", "12:00:00.015 session write completed"],
          }) }] };
        },
      }),
      defineTool({
        name: "save_report", description: "Save a triage summary and a recommended fix.",
        parameters: Type.Object({ summary: Type.String(), recommendation: Type.String() }),
        replay: "safe",
        execute: async (args, api, context) => {
          emit({ type: "tool", name: "save_report", taskId: api.taskId });
          // The task ID survives restart. Commit the effect and its deduplication
          // key together; replay may execute this function more than once.
          const inserted = await api.commit(async (tx) => {
            const reports = await tx.doc(Reports, api.conversationId);
            if (reports.items.some((report) => report.taskId === api.taskId)) return false;
            reports.items.push({ taskId: api.taskId, ...args });
            reports.writes += 1;
            return true;
          }, context);
          emit({ type: "report", inserted, taskId: api.taskId });
          if (pauseAfterCommit) {
            // The parent kills this process only after this persisted boundary.
            // No close(), cleanup, or successful tool result gets a chance to run.
            emit({ type: "crash-ready" });
            await delay(60_000);
            throw new Error("Expected the demo supervisor to kill this worker.");
          }
          return { content: [{ type: "text", text: inserted ? "Report saved." : "Report already saved; reused the committed report." }] };
        },
      }),
    ],
  });
}
