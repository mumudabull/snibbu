/**
 * Replit adapter for completed upstream server/index.js.
 * Physics, frame parsing, score recomputation, flags and name cleanup are upstream.
 * Only hosting/pool integration, durable rate limits and practice-only policy differ.
 */
import { Router, type IRouter } from "express";
import { createHmac, randomInt, randomUUID } from "node:crypto";
import { db, pool, gameRateLimits } from "@workspace/db";
import { sql } from "drizzle-orm";
import { loadContest, sanitizeName } from "@workspace/snibbu-upstream/contest";
import { replayPool } from "../lib/replay-pool";
import { IssueRunBody, IssueRunResponse, SubmitRunParams, SubmitRunResponse, GetLeaderboardResponse, GetContestResponse } from "@workspace/api-zod";

const router: IRouter = Router();
const TITLE = "Snibbu the Crab — Cross the Chop";
// Deliberate release lock: even existing environment settings cannot activate a contest.
// Owner must supply dates, timezone, rules, prizes and eligibility AND instruct activation.
const contest = () => loadContest({});

router.use(async (req, res, next): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!["/runs", "/leaderboard", "/contest", "/health"].includes(req.path) && !/^\/runs\/[^/]+\/submit$/.test(req.path)) {
    next(); return;
  }
  const secret = process.env.SESSION_SECRET;
  if (!secret) { res.status(503).json({ error: "Run service unavailable." }); return; }
  const identity = createHmac("sha256", secret).update(req.ip || "unknown").digest("hex");
  const bucket = req.method === "GET" ? "upstream-read" : req.path === "/runs" ? "upstream-runs" : "upstream-submit";
  const key = `${identity}:${bucket}`;
  const minute = new Date(Math.floor(Date.now() / 60000) * 60000);
  const [limit] = await db.insert(gameRateLimits).values({ key, windowStart: minute, count: 1 })
    .onConflictDoUpdate({
      target: gameRateLimits.key,
      set: {
        count: sql`CASE WHEN ${gameRateLimits.windowStart} = ${minute} THEN ${gameRateLimits.count} + 1 ELSE 1 END`,
        windowStart: minute,
      },
    }).returning();
  const max = req.method === "GET" ? 240 : req.path === "/runs" ? 30 : 20;
  if (limit.count > max) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Too many requests. Please wait one minute." }); return;
  }
  next();
});

router.get("/health", (_req, res) => { res.json({ ok: true, title: TITLE }); });
router.get("/contest", (_req, res) => { res.json(GetContestResponse.parse(contest())); });

router.get("/leaderboard", async (req, res): Promise<void> => {
  const limit = Math.max(1, Math.min(50, parseInt(String(req.query.limit || "20"), 10) || 20));
  const contestOnly = req.query.contest === "1";
  const result = await pool.query(
    "SELECT s.run_id, r.display_name, s.score, s.level, s.victory, s.review_status, s.created_at " +
    "FROM submissions s JOIN runs r ON r.id = s.run_id " +
    "WHERE s.review_status IN ('clean', 'flagged') AND s.contest_entry = FALSE AND $1::boolean = FALSE " +
    "ORDER BY s.score DESC, s.level DESC, s.victory DESC, s.created_at ASC, s.run_id ASC LIMIT $2",
    [contestOnly, limit],
  );
  res.json(GetLeaderboardResponse.parse({
    title: TITLE,
    ranking: "score DESC, level DESC, victory DESC, submitted time ASC, run id ASC",
    contest: contest(),
    entries: result.rows.map((row, index) => ({
      rank: index + 1, name: row.display_name, score: row.score, level: row.level,
      victory: row.victory, reviewStatus: row.review_status, prizeEligible: false,
      contestEntry: false, claimIdentityVerified: false, submittedAt: row.created_at.toISOString(),
    })),
  }));
});

router.post("/runs", async (req, res): Promise<void> => {
  const parsed = IssueRunBody.strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid run request." }); return; }
  const id = randomUUID();
  const seed = randomInt(1, 0x7fffffff);
  const name = sanitizeName(parsed.data.name);
  await pool.query(
    "INSERT INTO runs (id, seed, display_name, submit_expires_at, contest_eligible) VALUES ($1,$2,$3,$4,FALSE)",
    [id, seed, name, new Date(Date.now() + 6 * 60 * 60 * 1000)],
  );
  res.status(201).json(IssueRunResponse.parse({
    runId: id, seed, name, levelCount: 99, contestEligible: false, contest: contest(),
  }));
});

router.post("/runs/:runId/submit", async (req, res): Promise<void> => {
  const params = SubmitRunParams.safeParse(req.params);
  if (!params.success || !Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ error: "Invalid gameplay replay." }); return;
  }
  const rawBody = req.body as Buffer;
  const runId = params.data.runId;
  const candidate = await pool.query("SELECT * FROM runs WHERE id = $1", [runId]);
  if (!candidate.rowCount) {
    res.status(404).json({ error: "Unknown run." }); return;
  }
  const candidateRun = candidate.rows[0];
  if (candidateRun.submitted) {
    const prior = await pool.query("SELECT score, level, victory, review_status FROM submissions WHERE run_id=$1", [runId]);
    const saved = prior.rows[0];
    res.status(409).json({
      error: "This run was already submitted.", score: saved?.score, level: saved?.level,
      victory: saved?.victory, reviewStatus: saved?.review_status,
      prizeEligible: false, contestEntry: false, claimIdentityVerified: false,
    }); return;
  }
  if (new Date(candidateRun.submit_expires_at).getTime() < Date.now()) {
    res.status(410).json({ error: "This run expired." }); return;
  }
  let validation;
  try {
    validation = await replayPool.validate(candidateRun.seed, rawBody);
  } catch (error) {
    if (error instanceof Error && error.message === "Replay validation capacity is full.") {
      res.setHeader("Retry-After", "1");
      res.status(503).json({ error: "Replay validation is busy. Please retry shortly." }); return;
    }
    if (error instanceof Error && error.message.startsWith("Invalid replay: ")) {
      res.status(400).json({ error: error.message.slice("Invalid replay: ".length) }); return;
    }
    throw error;
  }
  const result = validation.result;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT * FROM runs WHERE id = $1 FOR UPDATE", [runId]);
    if (!found.rowCount) {
      await client.query("ROLLBACK"); res.status(404).json({ error: "Unknown run." }); return;
    }
    const run = found.rows[0];
    if (run.submitted) {
      const prior = await client.query("SELECT score, level, victory, review_status FROM submissions WHERE run_id=$1", [runId]);
      const saved = prior.rows[0];
      await client.query("ROLLBACK");
      res.status(409).json({
        error: "This run was already submitted.", score: saved?.score, level: saved?.level,
        victory: saved?.victory, reviewStatus: saved?.review_status,
        prizeEligible: false, contestEntry: false, claimIdentityVerified: false,
      }); return;
    }
    if (new Date(run.submit_expires_at).getTime() < Date.now()) {
      await client.query("ROLLBACK"); res.status(410).json({ error: "This run expired." }); return;
    }
    if (result.totalMs > Date.now() - new Date(run.created_at).getTime() + 2000) {
      await client.query("ROLLBACK"); res.status(422).json({ error: "Gameplay clock exceeds the elapsed run time." }); return;
    }
    if (validation.input.score != null && validation.input.score !== result.score) {
      await client.query("ROLLBACK"); res.status(422).json({ error: "Submitted score does not match the replay.", replayScore: result.score }); return;
    }
    if (validation.input.level != null && validation.input.level !== result.level) {
      await client.query("ROLLBACK"); res.status(422).json({ error: "Submitted level does not match the replay.", replayLevel: result.level }); return;
    }
    await client.query(
      "INSERT INTO submissions (run_id,score,level,victory,duration_ms,hop_count,review_status,flag_reasons,prize_eligible,contest_entry,log) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,FALSE,FALSE,$9::jsonb)",
      [runId, result.score, result.level, result.victory, result.totalMs, result.hopCount,
        result.reviewStatus, JSON.stringify(result.flags), JSON.stringify(validation.frames)],
    );
    await client.query("UPDATE runs SET submitted=TRUE WHERE id=$1", [runId]);
    await client.query("COMMIT");
    res.status(201).json(SubmitRunResponse.parse({
      runId, name: run.display_name, score: result.score, level: result.level,
      victory: result.victory, reviewStatus: result.reviewStatus, flags: result.flags,
      prizeEligible: false, contestEntry: false, claimIdentityVerified: false,
    }));
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally { client.release(); }
});

export default router;
