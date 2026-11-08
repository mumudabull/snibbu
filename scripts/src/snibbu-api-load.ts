import { performance } from "node:perf_hooks";
import { pool } from "@workspace/db";
import L from "@workspace/snibbu-upstream";

const base = process.env.SNIBBU_API_BASE ?? "http://127.0.0.1:8080/api";
const baseUrl = new URL(base);
if (!["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname)) {
  throw new Error("Load tests must target a local API server.");
}

const runIds: string[] = [];
const runToken = Math.random().toString(36).slice(2, 9).toUpperCase();
type Result = { status: number; body: any; elapsedMs: number };

async function request(path: string, options: RequestInit = {}): Promise<Result> {
  const started = performance.now();
  const response = await fetch(`${base}${path}`, options);
  const body = await response.json();
  return { status: response.status, body, elapsedMs: performance.now() - started };
}

function frames(count: number) {
  return Array.from({ length: count }, () => ({ dt: 0, hop: null }));
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0;
}

function report(label: string, results: Result[]) {
  const times = results.map(result => result.elapsedMs);
  console.log(JSON.stringify({
    workload: label,
    requests: results.length,
    statuses: results.reduce<Record<string, number>>((counts, result) => {
      counts[result.status] = (counts[result.status] ?? 0) + 1;
      return counts;
    }, {}),
    p50Ms: Math.round(percentile(times, 0.5)),
    p95Ms: Math.round(percentile(times, 0.95)),
    maxMs: Math.round(Math.max(...times)),
  }));
}

function verify(results: Result[], expected: number[]) {
  for (const [index, result] of results.entries()) {
    if (result.status !== expected[index]) {
      throw new Error(`Unexpected HTTP ${result.status}; expected ${expected[index]}.`);
    }
  }
}

async function main() {
  // Fixed one-minute buckets need a clean window for the configured request caps.
  const waitMs = 60_050 - (Date.now() % 60_000);
  await new Promise(resolve => setTimeout(resolve, waitMs));

  // More than the per-address run limit proves that forwarded client identity
  // is being interpreted by Express rather than collapsed to the proxy socket.
  const clients = 42;
  const issueResults = await Promise.all(Array.from({ length: clients }, async (_, i) => {
    const result = await request("/runs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": `198.51.100.${i + 1}`,
      },
      body: JSON.stringify({ name: `Load${runToken}${i}` }),
    });
    if (result.status !== 201) return result;
    runIds.push(result.body.runId);
    return result;
  }));
  verify(issueResults, Array(clients).fill(201));
  report("simultaneous run issuance", issueResults);

  const leaderboardResults = await Promise.all(Array.from({ length: 24 }, () =>
    request("/leaderboard?limit=50"),
  ));
  verify(leaderboardResults, Array(leaderboardResults.length).fill(200));
  if (leaderboardResults.some(result => result.body.entries.some((entry: any) => entry.name.startsWith(`Load${runToken}`)))) {
    throw new Error("An unsubmitted load-test run unexpectedly appeared in the leaderboard.");
  }
  report("simultaneous leaderboard reads", leaderboardResults);

  const shortFrames = frames(28);
  const longFrames = frames(40_000);
  const submittedRuns = runIds.slice(0, clients - 1);
  const earlyStarted = performance.now();
  const early = await request(`/runs/${submittedRuns[0]}/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "203.0.113.1",
    },
    body: JSON.stringify({ frames: shortFrames }),
  });
  if (early.status !== 201) throw new Error(`Early replay failed: ${early.status}.`);
  console.log(JSON.stringify({
    workload: "early-level replay verification",
    frames: shortFrames.length,
    elapsedMs: Math.round(performance.now() - earlyStarted),
  }));

  const longPayload = JSON.stringify({ frames: longFrames });
  if (Buffer.byteLength(longPayload) > 900_000) {
    throw new Error("The late-size replay fixture exceeds the API's request body limit.");
  }
  const longWork = Promise.all(submittedRuns.slice(1).map((runId, index) =>
    request(`/runs/${runId}/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": `203.0.113.${index + 2}`,
      },
      body: longPayload,
    }),
  ));
  const concurrentReadWork = Promise.all(Array.from({ length: 24 }, () =>
    request("/leaderboard?limit=50"),
  ));
  const [longResults, concurrentReads] = await Promise.all([longWork, concurrentReadWork]);
  const queueStatuses = longResults.reduce<Record<string, number>>((counts, result) => {
    counts[result.status] = (counts[result.status] ?? 0) + 1;
    return counts;
  }, {});
  if (longResults.some(result => result.status !== 201 && result.status !== 503) || !queueStatuses[503]) {
    throw new Error(`Expected bounded replay queue responses (201/503), received ${JSON.stringify(queueStatuses)}.`);
  }
  verify(concurrentReads, Array(concurrentReads.length).fill(200));
  report("large replay verification", longResults);
  report("leaderboard reads during replay load", concurrentReads);

  const duplicateRunId = runIds[clients - 1];
  const duplicatePayload = JSON.stringify({ frames: longFrames });
  const duplicateResults = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    request(`/runs/${duplicateRunId}/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": `203.0.113.${100 + index}`,
      },
      body: duplicatePayload,
    }),
  ));
  const duplicateStatuses = duplicateResults.map(result => result.status).sort((a, b) => a - b);
  verify(duplicateStatuses.map(status => ({ status, body: {}, elapsedMs: 0 })), [201, ...Array(7).fill(409)]);
  report("simultaneous duplicate submission", duplicateResults);

  const earlyMatch = L.createMatch({ seed: 1 });
  L.start(earlyMatch);
  const lateMatch = L.createMatch({ seed: 1 });
  L.debugSetLevel(lateMatch, 99);
  L.start(lateMatch);
  for (const [label, match] of [["early-level", earlyMatch], ["late-level", lateMatch]] as const) {
    const started = performance.now();
    for (let i = 0; i < 15_000; i++) L.stepFrame(match, 0, null);
    console.log(JSON.stringify({
      workload: `${label} game-physics frame loop`,
      frames: 15_000,
      level: match.level,
      elapsedMs: Math.round(performance.now() - started),
    }));
  }
}

try {
  await main();
} finally {
  if (runIds.length) {
    await pool.query("DELETE FROM submissions WHERE run_id = ANY($1::uuid[])", [runIds]);
    await pool.query("DELETE FROM runs WHERE id = ANY($1::uuid[])", [runIds]);
    const board = await request("/leaderboard?limit=50");
    if (board.body.entries.some((entry: any) => entry.name.startsWith(`Load${runToken}`))) {
      throw new Error("Load-test entries remained visible after cleanup.");
    }
    console.log("Load-test entries removed and absent from the leaderboard.");
  }
  await pool.end();
}
