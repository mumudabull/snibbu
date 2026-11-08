"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const { migrate } = require("./migrate");
const { loadContest, sanitizeName } = require("./contest");
const { parseFrames, replaySubmission } = require("./validate");

const GAME_ROOT = path.join(__dirname, "..", "game");
const MAX_BODY = 1000000;
const RUN_TTL_MS = 6 * 60 * 60 * 1000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function createApp(options) {
  options = options || {};
  const env = options.env || process.env;
  const databaseUrl = options.databaseUrl || env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required. This server does not start a pretend leaderboard without Postgres.");
  }
  const pool = new Pool({ connectionString: databaseUrl });
  const limits = options.rateLimit || { runsPerMinute: 30, submitsPerMinute: 20 };
  const hits = new Map();
  const nowFn = options.now || function () { return new Date(); };

  function contest() {
    return loadContest(env, nowFn());
  }

  function allow(ip, bucket, max) {
    const now = Date.now();
    const key = bucket + ":" + ip;
    const recent = (hits.get(key) || []).filter(function (t) { return now - t < 60000; });
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  }

  function send(res, status, body, type) {
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": type || "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(payload),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(payload);
  }

  function readBody(req) {
    return new Promise(function (resolve, reject) {
      const chunks = [];
      let size = 0;
      let settled = false;
      req.on("data", function (chunk) {
        size += chunk.length;
        if (size > MAX_BODY && !settled) {
          settled = true;
          reject(Object.assign(new Error("too large"), { status: 413 }));
          return;
        }
        if (!settled) chunks.push(chunk);
      });
      req.on("end", function () {
        if (settled) return;
        settled = true;
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw) return resolve({});
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(Object.assign(new Error("invalid json"), { status: 400 }));
        }
      });
      req.on("error", function (err) {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
    });
  }

  async function leaderboard(contestOnly, limit) {
    const result = await pool.query(
      "SELECT s.run_id, r.display_name, s.score, s.level, s.victory, s.review_status, s.prize_eligible, s.contest_entry, s.created_at " +
        "FROM submissions s JOIN runs r ON r.id = s.run_id " +
        "WHERE s.review_status IN ('clean', 'flagged') AND ($1::boolean = FALSE OR s.contest_entry) " +
        "ORDER BY s.score DESC, s.level DESC, s.victory DESC, s.created_at ASC, s.run_id ASC " +
        "LIMIT $2",
      [contestOnly, limit]
    );
    return result.rows.map(function (row, index) {
      return {
        rank: index + 1,
        name: row.display_name,
        score: row.score,
        level: row.level,
        victory: row.victory,
        reviewStatus: row.review_status,
        prizeEligible: row.prize_eligible,
        contestEntry: row.contest_entry,
        submittedAt: row.created_at.toISOString(),
      };
    });
  }

  async function createRun(name) {
    const status = contest();
    const id = crypto.randomUUID();
    const seed = crypto.randomInt(1, 0x7fffffff);
    const displayName = sanitizeName(name);
    const eligible = status.open === true;
    await pool.query(
      "INSERT INTO runs (id, seed, display_name, submit_expires_at, contest_eligible) VALUES ($1, $2, $3, $4, $5)",
      [id, seed, displayName, new Date(Date.now() + RUN_TTL_MS), eligible]
    );
    return {
      status: 201,
      body: {
        runId: id,
        seed: seed,
        name: displayName,
        levelCount: 99,
        contestEligible: eligible,
        contest: status,
      },
    };
  }

  async function submitRun(runId, body) {
    const parsed = parseFrames(body);
    if (parsed.error) return { status: 400, body: { error: parsed.error } };
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query("SELECT * FROM runs WHERE id = $1 FOR UPDATE", [runId]);
      if (!found.rowCount) {
        await client.query("ROLLBACK");
        return { status: 404, body: { error: "Unknown run." } };
      }
      const run = found.rows[0];
      if (run.submitted) {
        const prior = await client.query(
          "SELECT score, level, victory, review_status, prize_eligible, contest_entry FROM submissions WHERE run_id = $1",
          [runId]
        );
        await client.query("ROLLBACK");
        const row = prior.rows[0];
        return {
          status: 409,
          body: {
            error: "This run was already submitted.",
            score: row ? row.score : null,
            level: row ? row.level : null,
            victory: row ? row.victory : null,
            reviewStatus: row ? row.review_status : null,
            prizeEligible: row ? row.prize_eligible : false,
            contestEntry: row ? row.contest_entry : false,
          },
        };
      }
      if (new Date(run.submit_expires_at).getTime() < Date.now()) {
        await client.query("ROLLBACK");
        return { status: 410, body: { error: "This run expired before it was submitted." } };
      }
      const result = replaySubmission(run.seed, parsed.frames);
      if (body.score != null && Number(body.score) !== result.score) {
        await client.query("ROLLBACK");
        return { status: 422, body: { error: "Submitted score does not match the replay.", replayScore: result.score } };
      }
      if (body.level != null && Number(body.level) !== result.level) {
        await client.query("ROLLBACK");
        return { status: 422, body: { error: "Submitted level does not match the replay.", replayLevel: result.level } };
      }
      const prizeEligible = run.contest_eligible === true && result.flags.length === 0;
      await client.query(
        "INSERT INTO submissions (run_id, score, level, victory, duration_ms, hop_count, review_status, flag_reasons, prize_eligible, contest_entry, log) " +
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb)",
        [
          runId,
          result.score,
          result.level,
          result.victory,
          result.totalMs,
          result.hopCount,
          result.reviewStatus,
          JSON.stringify(result.flags),
          prizeEligible,
          run.contest_eligible === true,
          JSON.stringify(parsed.frames),
        ]
      );
      await client.query("UPDATE runs SET submitted = TRUE WHERE id = $1", [runId]);
      await client.query("COMMIT");
      return {
        status: 201,
        body: {
          runId: runId,
          name: run.display_name,
          score: result.score,
          level: result.level,
          victory: result.victory,
          reviewStatus: result.reviewStatus,
          flags: result.flags,
          prizeEligible: prizeEligible,
          contestEntry: run.contest_eligible === true,
        },
      };
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch (ignore) {}
      throw err;
    } finally {
      client.release();
    }
  }

  function safeFile(urlPath) {
    const decoded = decodeURIComponent(urlPath.split("?")[0]);
    const rel = decoded === "/" ? "/index.html" : decoded;
    const full = path.normalize(path.join(GAME_ROOT, rel));
    if (full !== GAME_ROOT && !full.startsWith(GAME_ROOT + path.sep)) return null;
    return full;
  }

  const server = http.createServer(function (req, res) {
    const ip = req.socket.remoteAddress || "unknown";
    const url = new URL(req.url, "http://127.0.0.1");
    const route = url.pathname;
    Promise.resolve().then(async function () {
      if (req.method === "GET" && route === "/api/health") {
        return send(res, 200, { ok: true, title: "Snibbu the Crab — Cross the Chop" });
      }
      if (req.method === "GET" && route === "/api/contest") {
        return send(res, 200, contest());
      }
      if (req.method === "GET" && route === "/api/leaderboard") {
        const limit = Math.max(1, Math.min(50, parseInt(url.searchParams.get("limit") || "20", 10) || 20));
        const contestOnly = url.searchParams.get("contest") === "1";
        const rows = await leaderboard(contestOnly, limit);
        return send(res, 200, {
          title: "Snibbu the Crab — Cross the Chop",
          ranking: "score DESC, level DESC, victory DESC, submitted time ASC, run id ASC",
          contest: contest(),
          entries: rows,
        });
      }
      if (req.method === "POST" && route === "/api/runs") {
        if (!allow(ip, "runs", limits.runsPerMinute)) {
          return send(res, 429, { error: "Too many new runs. Wait a minute." });
        }
        const body = await readBody(req);
        const created = await createRun(body && body.name);
        return send(res, created.status, created.body);
      }
      const submitMatch = route.match(/^\/api\/runs\/([0-9a-f-]{36})\/submit$/i);
      if (req.method === "POST" && submitMatch) {
        if (!allow(ip, "submit", limits.submitsPerMinute)) {
          return send(res, 429, { error: "Too many submissions. Wait a minute." });
        }
        const body = await readBody(req);
        const saved = await submitRun(submitMatch[1], body);
        return send(res, saved.status, saved.body);
      }
      if (req.method === "GET" && !route.startsWith("/api/")) {
        const file = safeFile(route);
        if (!file) return send(res, 403, { error: "Forbidden." });
        fs.stat(file, function (err, stat) {
          if (err || !stat.isFile()) return send(res, 404, { error: "Not found." });
          res.writeHead(200, {
            "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          });
          fs.createReadStream(file).pipe(res);
        });
        return;
      }
      return send(res, 404, { error: "Not found." });
    }).catch(function (err) {
      if (err && err.status === 413) return send(res, 413, { error: "Request is too large." });
      if (err && err.status === 400) return send(res, 400, { error: "Request JSON is invalid." });
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: "Server error." });
    });
  });

  return {
    server: server,
    pool: pool,
    contest: contest,
    listen: function (port) {
      return new Promise(function (resolve) {
        server.listen(port || 0, "127.0.0.1", function () { resolve(server.address()); });
      });
    },
    close: async function () {
      await new Promise(function (resolve, reject) {
        server.close(function (err) { if (err) reject(err); else resolve(); });
      });
      await pool.end();
    },
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Refusing to start without a Postgres database.");
    process.exit(1);
  }
  const app = createApp({});
  await migrate(app.pool);
  const address = await app.listen(process.env.PORT || 3000);
  console.log("Snibbu the Crab — Cross the Chop listening on " + address.port);
}

if (require.main === module) {
  main().catch(function (err) {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { createApp: createApp, migrate: migrate };
