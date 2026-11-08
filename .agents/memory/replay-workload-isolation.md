---
name: Replay workload isolation
description: Performance lesson for high-volume replay submission paths.
---

For replay-heavy endpoints, moving only the simulation off the request thread is not enough. JSON decoding and per-frame validation can still block unrelated requests; keep the full payload parse, normalization, and simulation in bounded background workers.

**Why:** load measurements showed leaderboard latency remained high after simulation moved to workers because synchronous frame validation still occupied the API thread.

**How to apply:** when accepting large replay payloads, benchmark leaderboard response time during concurrent submissions and include body decoding, schema checks, and normalization in the same bounded validation path.
