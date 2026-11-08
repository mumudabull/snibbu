import test from "node:test";
import assert from "node:assert/strict";
import L from "@workspace/snibbu-upstream";
import { createRequire } from "node:module";

const base = "http://localhost:80/api";
const ids = [];
const require = createRequire(new URL("../../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const post = async (path, data) => {
  const res = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  return { status: res.status, body: await res.json() };
};
const framesFor = seed => {
  const m = L.createMatch({ seed }); L.start(m);
  const frames = Array.from({ length: 28 }, (_, i) => ({ dt: 16, hop: i === 3 ? "up" : null }));
  for (const frame of frames) L.stepFrame(m, frame.dt, frame.hop);
  assert.equal(m.score, 10);
  return frames;
};
const issue = async name => {
  const res = await post("/runs", { name }); assert.equal(res.status, 201);
  assert.equal(res.body.contestEligible, false); ids.push(res.body.runId); return res.body;
};

test.after(async () => {
  try {
    if (ids.length) {
      await db.query("DELETE FROM submissions WHERE run_id = ANY($1::uuid[])", [ids]);
      await db.query("DELETE FROM runs WHERE id = ANY($1::uuid[])", [ids]);
    }
  } finally {
    await db.end();
  }
});

test("Replit adapter: original replay, two clients, forged score/level, duplicates and explicit practice-only identity status", async () => {
  const contest = await (await fetch(base + "/contest")).json();
  assert.equal(contest.enabled, false); assert.equal(contest.open, false);
  for (const field of ["timezone", "startsAt", "endsAt", "rules", "prizes", "eligibility"]) assert.equal(contest[field], null);
  assert.equal((await post("/runs", { mode: "contest" })).status, 400);
  const a = await issue("Integration_A");
  const payload = { frames: framesFor(a.seed) };
  assert.equal((await post(`/runs/${a.runId}/submit`, { ...payload, score: 999999 })).status, 422);
  assert.equal((await post(`/runs/${a.runId}/submit`, { ...payload, level: 99 })).status, 422);
  assert.equal((await post(`/runs/${a.runId}/submit`, { frames: [{ dt: 16, hop: "teleport" }] })).status, 400);
  assert.equal((await post(`/runs/${a.runId}/submit`, { frames: [{ dt: .5 }] })).status, 400);
  assert.equal((await post(`/runs/${a.runId}/submit`, { frames: [{ dt: 16, x: 999 }] })).status, 400);
  const accepted = await post(`/runs/${a.runId}/submit`, payload);
  assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
  assert.equal(accepted.body.score, 10);
  assert.equal(accepted.body.contestEntry, false);
  assert.equal(accepted.body.prizeEligible, false);
  assert.equal(accepted.body.claimIdentityVerified, false);
  assert.equal((await post(`/runs/${a.runId}/submit`, payload)).status, 409);
  const b = await issue("Integration_B");
  assert.equal((await post(`/runs/${b.runId}/submit`, { frames: framesFor(b.seed) })).status, 201);
  const c = await issue("<Safe_Name>");
  assert.equal(c.name, "Safe_Name");
  assert.equal((await post(`/runs/${c.runId}/submit`, { frames: Array.from({ length: 20 }, () => ({ dt: 1000 })) })).status, 422);
  const huge = await fetch(base + "/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "x".repeat(1000001) }) });
  assert.equal(huge.status, 413);
  const first = await (await fetch(base + "/leaderboard")).json();
  const second = await (await fetch(base + "/leaderboard", { headers: { "User-Agent": "independent-second-client" } })).json();
  assert.deepEqual(first, second);
  assert.ok(first.entries.some(row => row.name === "Integration_A" && row.score === 10));
  assert.ok(first.entries.some(row => row.name === "Integration_B" && row.score === 10));
  assert.ok(first.entries.every(row => !row.contestEntry && !row.prizeEligible && !row.claimIdentityVerified));
  const ordered = first.entries.filter(row => ["Integration_A", "Integration_B"].includes(row.name));
  assert.equal(ordered[0].name, "Integration_A");
  assert.deepEqual((await (await fetch(base + "/leaderboard?contest=1")).json()).entries, []);
});
