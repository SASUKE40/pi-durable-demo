# Pi Durable: crash, resume, retry

A small TypeScript demo inspired by [Earendil’s Pi Durable announcement](https://earendil.com/posts/pi-durable/), using the published `@earendil-works/pi-durable` **1.0.2** package.

An agent reads a fictional flaky-login issue and saves a triage report. A supervisor kills the worker with **SIGKILL after the report is committed but before the tool returns**, then starts two new processes against the same SQLite database.

The default model is explicitly scripted so the demonstration is repeatable, free, and works offline after installation. The harness, conversation, tool execution, SQLite commits, recovery, and submission deduplication are real. An optional Anthropic mode uses a real model with the same tools.

## Run it

Requires Node.js **22.19+** and npm. Tested here with Node.js 26.10.

```sh
npm ci
npm run demo
```

The demo takes a few seconds and verifies these assertions before printing `PASS`:

1. The first worker finishes `read_issue`, commits one report, and dies during `save_report`.
2. A new worker calls `harness.resume()`. Only the interrupted `save_report` executes again, with its original task ID.
3. The tool finds its committed report and skips the duplicate write.
4. A third worker submits the same `requestId` and receives the same submission and answer, with no tool execution.

Each demo gets a new `.demo/run-*/agent.sqlite` database, which is kept for inspection. The supervisor waits for confirmation of the committed write before killing its own child process; it does not rely on a timing guess.

## Run the worker yourself

```sh
npm start
npm start
```

Both commands use `.demo/manual.sqlite`. The second prints the stored result. To start a separate job, choose a fresh database:

```sh
npm start -- --db .demo/another-job.sqlite
```

The request ID is intentionally fixed to `triage-issue-42-v1`. This demo handles one logical job per database. In an application, assign a distinct request ID to each new job and reuse it only for retries of that job. Keep one harness process per database.

## Optional live model

Set `ANTHROPIC_API_KEY` in your shell, then run:

```sh
npm start -- --live --db .demo/live.sqlite
```

The default is `claude-haiku-4-5`; override it with `--model <catalog-model-id>`. The worker rejects a missing key or unknown model before opening storage. Use a fresh database when changing model or mode.

Live mode makes paid Anthropic requests. It uses the same local fictional issue and saves a report in SQLite; it does not access GitHub or change your code. Model output and tool choices may vary. The automated crash proof uses the scripted mode. Live provider calls have not been exercised as part of this demo’s verification.

## Read the code

- [`src/worker.ts`](src/worker.ts): opens SQLite and the harness, resumes tasks, submits with a stable request ID, and retrieves the answer and report.
- [`src/triage.ts`](src/triage.ts): defines two replay-safe tools and the `Reports` document. The report and its task-ID deduplication key are written in one transaction.
- [`src/scripted-model.ts`](src/scripted-model.ts): an in-process pi-ai provider that deterministically requests the tools. It performs no network calls.
- [`src/demo.ts`](src/demo.ts): narrates the three-process demonstration.
- [`src/recovery.ts`](src/recovery.ts): supervises workers, injects the crash, and checks recovery invariants.
- [`test/recovery.test.ts`](test/recovery.test.ts): exercises real child-process crashes and the uninterrupted path.

`replay: "safe"` permits a tool to run again; it does not automatically make external effects exactly-once. Here, deduplication works because the report and task ID live in the same atomic database commit. An external API would need its own durable idempotency key. A crash inside a tool replays that tool from the beginning, not from an arbitrary JavaScript line.

## Verify

```sh
npm run check
npm test
```

Tests use temporary databases and remove them afterward. Package versions are pinned and `package-lock.json` is included for reproducible installation; Pi Durable is experimental, so check its [upstream README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md) when upgrading.
