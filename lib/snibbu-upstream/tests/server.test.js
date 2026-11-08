const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { createApp, migrate } = require("../server/index");
const { assess } = require("../server/validate");
const { loadContest, sanitizeName } = require("../server/contest");
const L = require("../game/js/logic.js");

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://snibbu:snibbu@127.0.0.1:5432/snibbu_test";

function request(base, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const url = new URL(pathname, base);
    const req = http.request(
      {
        method: method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: data
          ? { "Content-Type": "application/json", "Content-Length": data.length }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let parsed = raw;
          try { parsed = JSON.parse(raw); } catch (err) { parsed = raw; }
          resolve({ status: res.statusCode, body: parsed, raw: raw });
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function scoringFrames(seed) {
  const frames = [];
  const live = L.createMatch({ seed: seed });
  L.start(live);
  function push(dt, hop) {
    frames.push({ dt: dt, hop: hop });
    L.stepFrame(live, dt, hop);
  }
  for (let i = 0; i < 3; i++) push(16, null);
  push(16, "up");
  for (let i = 0; i < 24; i++) push(16, null);
  return { frames: frames, score: live.score, level: live.level };
}

async function boot(extra) {
  const app = createApp(Object.assign({ databaseUrl: DATABASE_URL, env: {} }, extra || {}));
  await migrate(app.pool);
  const address = await app.listen(0);
  return { app: app, base: "http://127.0.0.1:" + address.port };
}

let main;

test.before(async () => {
  main = await boot();
});

test.after(async () => {
  await main.app.close();
});

test.beforeEach(async () => {
  await main.app.pool.query("TRUNCATE TABLE runs CASCADE");
});

test("contest stays disabled until the owner supplies a full schedule", () => {
  const off = loadContest({}, new Date());
  assert.equal(off.enabled, false);
  assert.equal(off.open, false);
  assert.equal(off.startsAt, null);
  assert.equal(off.prizes, null);
  const incomplete = loadContest({ CONTEST_ENABLED: "true", CONTEST_PRIZES: "a mug" }, new Date());
  assert.equal(incomplete.enabled, false);
  assert.equal(incomplete.phase, "incomplete");
  assert.equal(incomplete.prizes, null);
  const now = new Date("2026-06-01T00:00:00Z");
  const closed = loadContest({
    CONTEST_ENABLED: "true",
    CONTEST_TIMEZONE: "UTC",
    CONTEST_START: "2026-01-01T00:00:00Z",
    CONTEST_END: "2026-02-01T00:00:00Z",
    CONTEST_RULES: "Play the game.",
    CONTEST_PRIZES: "To be announced by the owner.",
    CONTEST_ELIGIBILITY: "Owner sets eligibility.",
  }, now);
  assert.equal(closed.enabled, true);
  assert.equal(closed.open, false);
  assert.equal(closed.phase, "after");
});

test("names are sanitized and suspicious victories are flagged, not invented", () => {
  assert.equal(sanitizeName("  <Ace>\n "), "Ace");
  assert.equal(sanitizeName("abcdefghijklmnopqrstuvwxyz"), "abcdefghijklmnop");
  assert.equal(sanitizeName("   "), "Snibbu");
  assert.deepEqual(assess({ victory: true, level: 99, totalMs: 1000 }), ["implausible_duration"]);
  assert.deepEqual(assess({ victory: false, level: 1, totalMs: 500 }), []);
});

test("two clients share one ranked board, forgeries and duplicates do not stick", async () => {
  const base = main.base;
  const adaRun = await request(base, "POST", "/api/runs", { name: "  <Ada> " });
  const beaRun = await request(base, "POST", "/api/runs", { name: "Bea" });
  assert.equal(adaRun.status, 201);
  assert.equal(adaRun.body.name, "Ada");
  assert.equal(adaRun.body.contestEligible, false);
  assert.equal(adaRun.body.contest.startsAt, null);

  const adaPlay = scoringFrames(adaRun.body.seed);
  assert.equal(adaPlay.score, 10);
  const forged = await request(base, "POST", "/api/runs/" + adaRun.body.runId + "/submit", {
    frames: adaPlay.frames,
    score: 999999,
    level: 99,
  });
  assert.equal(forged.status, 422);
  assert.equal(forged.body.replayScore, 10);

  const honest = await request(base, "POST", "/api/runs/" + adaRun.body.runId + "/submit", {
    frames: adaPlay.frames,
  });
  assert.equal(honest.status, 201);
  assert.equal(honest.body.score, 10);
  assert.equal(honest.body.level, 1);
  assert.equal(honest.body.prizeEligible, false);
  assert.equal(honest.body.contestEntry, false);
  assert.equal(honest.body.reviewStatus, "clean");

  const again = await request(base, "POST", "/api/runs/" + adaRun.body.runId + "/submit", {
    frames: adaPlay.frames,
  });
  assert.equal(again.status, 409);
  assert.equal(again.body.score, 10);

  const bea = await request(base, "POST", "/api/runs/" + beaRun.body.runId + "/submit", {
    frames: [{ dt: 16, hop: null }, { dt: 16, hop: null }],
  });
  assert.equal(bea.status, 201);
  assert.equal(bea.body.score, 0);

  const board = await request(base, "GET", "/api/leaderboard");
  assert.equal(board.status, 200);
  assert.equal(board.body.entries.length, 2);
  assert.equal(board.body.entries[0].name, "Ada");
  assert.equal(board.body.entries[0].score, 10);
  assert.equal(board.body.entries[0].rank, 1);
  assert.equal(board.body.entries[1].name, "Bea");
  assert.equal(board.body.entries[1].score, 0);
  assert.equal(JSON.stringify(board.body).includes("999999"), false);
});

test("a restarted server still serves the same rows", async () => {
  const first = await request(main.base, "POST", "/api/runs", { name: "Persist" });
  const play = scoringFrames(first.body.seed);
  const saved = await request(main.base, "POST", "/api/runs/" + first.body.runId + "/submit", { frames: play.frames });
  assert.equal(saved.status, 201);
  await main.app.close();
  main = await boot();
  const board = await request(main.base, "GET", "/api/leaderboard");
  assert.equal(board.body.entries.length, 1);
  assert.equal(board.body.entries[0].name, "Persist");
  assert.equal(board.body.entries[0].score, 10);
  assert.equal(board.body.entries[0].level, 1);
});

test("a closed contest accepts practice scores and does not mark them eligible", async () => {
  const closed = await boot({
    env: {
      CONTEST_ENABLED: "true",
      CONTEST_TIMEZONE: "America/New_York",
      CONTEST_START: "2020-01-01T00:00:00Z",
      CONTEST_END: "2020-01-02T00:00:00Z",
      CONTEST_RULES: "Owner-supplied rules.",
      CONTEST_PRIZES: "Owner-supplied prizes.",
      CONTEST_ELIGIBILITY: "Owner-supplied eligibility.",
    },
  });
  try {
    const status = await request(closed.base, "GET", "/api/contest");
    assert.equal(status.body.enabled, true);
    assert.equal(status.body.open, false);
    assert.equal(status.body.phase, "after");
    const run = await request(closed.base, "POST", "/api/runs", { name: "Late" });
    assert.equal(run.body.contestEligible, false);
    const play = scoringFrames(run.body.seed);
    const saved = await request(closed.base, "POST", "/api/runs/" + run.body.runId + "/submit", { frames: play.frames });
    assert.equal(saved.status, 201);
    assert.equal(saved.body.contestEntry, false);
    assert.equal(saved.body.prizeEligible, false);
    const contestBoard = await request(closed.base, "GET", "/api/leaderboard?contest=1");
    assert.equal(contestBoard.body.entries.length, 0);
  } finally {
    await closed.app.close();
  }
});

test("an open contest can mark a clean run prize-eligible", async () => {
  const open = await boot({
    env: {
      CONTEST_ENABLED: "true",
      CONTEST_TIMEZONE: "UTC",
      CONTEST_START: "2020-01-01T00:00:00Z",
      CONTEST_END: "2099-01-01T00:00:00Z",
      CONTEST_RULES: "Owner-supplied rules.",
      CONTEST_PRIZES: "Owner-supplied prizes.",
      CONTEST_ELIGIBILITY: "Owner-supplied eligibility.",
    },
  });
  try {
    const status = await request(open.base, "GET", "/api/contest");
    assert.equal(status.body.open, true);
    const run = await request(open.base, "POST", "/api/runs", { name: "OnTime" });
    assert.equal(run.body.contestEligible, true);
    const play = scoringFrames(run.body.seed);
    const saved = await request(open.base, "POST", "/api/runs/" + run.body.runId + "/submit", { frames: play.frames });
    assert.equal(saved.body.contestEntry, true);
    assert.equal(saved.body.prizeEligible, true);
    assert.equal(saved.body.reviewStatus, "clean");
  } finally {
    await open.app.close();
  }
});

test("rate limit, oversized bodies, and the static title page", async () => {
  const limited = await boot({ rateLimit: { runsPerMinute: 2, submitsPerMinute: 5 } });
  try {
    assert.equal((await request(limited.base, "POST", "/api/runs", { name: "A" })).status, 201);
    assert.equal((await request(limited.base, "POST", "/api/runs", { name: "B" })).status, 201);
    assert.equal((await request(limited.base, "POST", "/api/runs", { name: "C" })).status, 429);
  } finally {
    await limited.app.close();
  }
  const huge = Buffer.alloc(1000001, 97);
  const oversized = await new Promise((resolve, reject) => {
    const url = new URL(main.base);
    const req = http.request(
      {
        method: "POST",
        hostname: url.hostname,
        port: url.port,
        path: "/api/runs",
        headers: { "Content-Type": "application/json", "Content-Length": huge.length },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      }
    );
    req.on("error", reject);
    req.write(huge);
    req.end();
  });
  assert.equal(oversized, 413);
  const page = await request(main.base, "GET", "/");
  assert.equal(page.status, 200);
  assert.equal(page.raw.includes("Snibbu the Crab — Cross the Chop"), true);
});
