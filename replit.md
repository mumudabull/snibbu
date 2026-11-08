# Snibbu the Crab — Cross the Chop

The completed upstream HTML5 crossing game, integrated into this Replit app with
its PostgreSQL database and shared, replay-verified practice rankings.

## Standing product instructions

- Reuse the completed work from https://github.com/mumudabull/snibbu/pull/1,
  branch `cursor/snibbu-cross-the-chop-e799`. Do not build a divergent game.
  **Why:** the owner explicitly requested integration of the completed game.
- Do not alter snibbu.fun, publish to production, or activate a contest without
  another explicit owner instruction.
- Keep the contest disabled and all results practice-only until the owner supplies
  actual dates, timezone, rules, prizes and eligibility. Never invent these.
- A display name alone is not proof of prize ownership. No claim-identity
  verification or prize award process is implemented.
- No wallet, payment, private key or token contract is required.
- Browser games are not perfectly cheat-proof. The server recomputes scores from
  legal gameplay and flags suspicious results; bots can still produce valid logs.
  Prize claims would need a separate private ownership and human-review process.

## Sources and integration

- `lib/snibbu-upstream/game`, `server`, `tests`: unmodified completed source.
- `lib/snibbu-upstream/INTEGRATION.md`: exact imported source revision and all
  adapter differences. These source trees were checked against GitHub's branch.
- `artifacts/snibbu/sync-upstream.mjs`: copies the original HTML, CSS, artwork and
  scripts into the existing Vite artifact at dev/build time. Explicit patches add
  practice/ownership notices, ignore game hotkeys while typing a display name,
  and refresh the visible leaderboard. The rules/renderer remain upstream's.
- `artifacts/api-server/src/routes/game.ts`: the original server's run, replay,
  ranking and submission behavior adapted to the shared Replit PostgreSQL pool.
- The old React game was removed. `lib/game-engine` is now only a compatibility
  export of the upstream engine, not a separate implementation.

## Practice and data safety

- This is a mobile web game/PWA, not a native iOS or Android binary. Players can
  install it from their browser's home-screen action; on iPhone use Share →
  Add to Home Screen. The app shell supports offline practice. The API and shared
  rankings always require network access and are never cached. The personal best
  persists in the browser on that device; completed online runs are submitted to
  the shared practice leaderboard. Offline scores are local practice only.
- The API adapter locks contest configuration to disabled, regardless of existing
  environment values or the old private settings table. It cannot accidentally
  enable a contest when dates are added.
- New results always have `contest_entry = false`, `prize_eligible = false`, and
  the API reports `claimIdentityVerified: false`.
- `runs` and `submissions` mirror the completed upstream schema. Earlier
  `game_runs` records are preserved and not reinterpreted under different rules.
- The original full frame replay format is used. Client-claimed score or level
  must agree with replay, and repeated submission of a run returns 409.
- Ranking order is score descending, level descending, victory descending,
  submission time ascending, then run ID ascending.
- In addition to upstream validation, the adapter rejects impossible elapsed
  clocks, persists rate limits across restarts, and uses structured request logs.
- Run IDs are unguessable capabilities, not proof of a person's prize ownership.
  Replays and review reasons remain private database data; no public admin exists.
- Required runtime variables: `DATABASE_URL`, `SESSION_SECRET`. Never display
  their values. There is no startup-time production schema migration.

## Run and verify

- Managed workflows: `artifacts/snibbu: web`, `artifacts/api-server: API Server`.
- `pnpm run typecheck` checks the workspace.
- `pnpm --filter @workspace/db run push` applies development schema changes.
- `pnpm --filter @workspace/api-spec run codegen` regenerates types after changes
  to `lib/api-spec/openapi.yaml`, which documents upstream's real API format.
- `pnpm --filter @workspace/scripts run test:snibbu` runs the original 24 tests.
  The wrapper creates a unique PostgreSQL schema, sets the child process search
  path to it, runs the tests there, and removes only that schema afterward.
  **Never run upstream's integration tests against public tables:** they truncate
  their own fixtures and simulate open/closed contests in isolated test servers.
  These tests do not enable the actual app's contest.
- With workflows running, `node --test scripts/src/snibbu-api.test.mjs` tests the
  actual Replit adapter, including forged score/level rejection, duplicate
  submission, separate HTTP clients, ranking ties, time limits and practice-only
  identity status.
- `pnpm --filter @workspace/scripts run test:snibbu-browser` checks the original
  UI on desktop and mobile: keyboard/WASD, pause, a real mobile run's automatic
  shared save, independent ranking visibility, D-pad/native swipe, PWA install
  metadata, offline practice and personal-best persistence after reload.
- Screenshots and test run IDs are in ignored `generated-artifacts/`.
  Remove only test-owned runs after verification; never leave fake leaderboard
  entries or delete real player records.
- The original 24 tests passed in isolation, adapter and browser checks passed,
  and actual shared rankings were compared across a managed API server restart.
  Progression/victory tests are automated fixtures, not a claim of human
  playtesting all 99 levels.
