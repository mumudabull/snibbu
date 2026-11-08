# Completed upstream implementation

Source: https://github.com/mumudabull/snibbu/pull/1
Branch: `cursor/snibbu-cross-the-chop-e799`
Imported commit: `f2df11f925bdf288ceffa439530c5eb162fe9f8c`

The `game/`, `server/` and `tests/` trees are the completed upstream source,
preserved without edits. The source engine and source replay validator are used
directly by the Replit API adapter. Do not replace them with a separately
reimplemented game.

`artifacts/snibbu/sync-upstream.mjs` copies the original HTML, CSS, scripts and
artwork into the existing Vite artifact. It applies small, explicit presentation
patches: practice-only wording, a prize-ownership warning, and a freshness poll.
The input adapter also prevents gameplay hotkeys from firing while a player types
their display name.
The gameplay engine and rendering/controls remain upstream's.

`artifacts/api-server/src/routes/game.ts` ports upstream's database operations
into the existing Express API, sharing this Replit project's PostgreSQL pool.
The API retains upstream's frame replay format, sorting and single-use run IDs.
Practice-only is locked in the adapter: contest scheduling is intentionally not
enabled by environment variables or the old private settings table. Existing
earlier `game_runs` records are retained, not reinterpreted under changed rules.

The adapter additionally enforces elapsed run time, keeps rate limits across
restarts, returns explicit non-ownership status and never marks any entry as
prize-eligible. No prize claims or identity verification are implemented.

Do not run upstream's server integration tests against public tables: they
truncate their own test fixtures. The Replit test runner creates a unique,
isolated PostgreSQL schema, runs the original 24 tests there, and removes only
that schema afterward. The original startup migration entry point is never used
by the actual app.
