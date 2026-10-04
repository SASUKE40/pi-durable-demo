import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runWorker, verifyRecovery } from "../src/recovery.ts";

test("SIGKILL recovery preserves identity, replays only unfinished work, and deduplicates effects", { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-durable-recovery-"));
  try {
    const db = join(directory, "agent.sqlite");
    const first = await runWorker(db, { crash: true });
    const resumed = await runWorker(db);
    const retried = await runWorker(db);
    verifyRecovery(first, resumed, retried);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("uninterrupted run saves one report and completed retry runs no tools", { timeout: 40_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-durable-normal-"));
  try {
    const db = join(directory, "agent.sqlite");
    const first = await runWorker(db);
    const retried = await runWorker(db);
    const done = first.find((event) => event.type === "done");
    assert(done);
    assert.equal(done.reports?.writes, 1);
    assert.equal(done.reports.items.length, 1);
    assert.deepEqual(retried.find((event) => event.type === "done"), done);
    assert(!retried.some((event) => event.type === "tool"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
