# Snibbu the Crab — Cross the Chop

Hop candle traffic, ride the moving bids, and clear levels 1 through 99. Snibbu stays the yellow crab. The game runs in a phone or desktop browser.

Two ways to play:

- **Official.** The Node server deals a run id and a seed. Your browser records each frame. The server replays that log with the same rules and stores the score it computes. That is the shared leaderboard.
- **Practice.** Opening `index.html` as a file, or the single-file build, never submits. The banner says practice. Those runs are not contest results.

Nothing here connects a wallet or collects an email address.

## Play on a server

From the repository root, with Postgres running and `DATABASE_URL` set:

```bash
npm install
npm start
```

The process listens on `PORT` (default `3000`) and serves this folder plus `/api`. Open that origin in a browser. Type a display name (16 characters after cleanup) and press Start.

You can also point any static host at this folder for practice. Official scores need this Node service and a database.

## Controls

- Desktop: arrow keys or WASD. `P` or `Escape` pauses, `R` restarts, `M` toggles sound, `Enter` or `Space` starts.
- Phone: swipe the board, or use the D-pad. Buttons are at least 48px. The page does not scroll while you play.
- Sound stays off until you turn it on.
- Best score on this browser is kept in `localStorage`. The shared board is separate and is ranked by the server.

## Levels

Level 1 is the slowest. Each level shifts lane direction, which lane is quick, and how tight the gaps are. Every 10th level eases off a little. Speed levels off and never goes past 190 pixels per second, so level 99 is still a timing game. Clearing level 99 shows the victory screen and does not start a level 100. Clearing a multiple of 10 gives one life, up to five.

## Shared leaderboard

`GET /api/leaderboard` returns real rows from Postgres. Rank is:

1. score, highest first
2. level, highest first
3. victory (a full clear ranks above the same score that did not clear)
4. earlier submission first
5. run id, ascending, if the rest ties

A row shows the display name, server score, level, and whether the run was flagged. There is no local stand-in and no sample ranks.

Submitting a score sends `{ frames: [{ dt, hop }] }` for a server-issued run. The server ignores a client score. If a body includes `score` or `level` and it disagrees with the replay, the response is `422` and nothing is stored. The same run cannot be submitted twice (`409`). Requests over 1,000,000 bytes are refused. New runs and submits are rate limited per address.

Runs are not perfectly cheat-proof. Someone can still write a client that produces a legal log. Fast clears are stored with `reviewStatus: "flagged"` and `prizeEligible: false`. Clean runs can be prize-eligible only while a contest is actually open.

### Contest

Contest mode is **off** unless every one of these is set:

| Variable | Meaning |
| --- | --- |
| `CONTEST_ENABLED` | `true` |
| `CONTEST_TIMEZONE` | IANA zone, such as `America/New_York` |
| `CONTEST_START` | ISO start instant |
| `CONTEST_END` | ISO end instant, after the start |
| `CONTEST_RULES` | Rules text the owner wrote |
| `CONTEST_PRIZES` | Prizes the owner is actually offering |
| `CONTEST_ELIGIBILITY` | Who may compete |

If any of those are missing, `/api/contest` stays closed and does not invent dates or prizes. When the set is complete, the server allows a contest entry only for runs created inside the window. There is no public admin URL. Changing the contest means editing the environment and restarting the process.

Practice outside the window still saves to the shared board, marked as not a contest entry and not prize-eligible.

### What a winner claim still needs

A display name is not an identity. This build does not collect email, phone, wallet, or any claim token. Before prizes, the owner needs a separate check: match the winning run id, review flagged logs, and decide how a person proves they played. That step is not implemented.

## Hosting

Any host that runs Node and Postgres works. Replit is a reasonable fit because it injects `PORT` and can provide `DATABASE_URL` from its Postgres database. This repository does not provision that database and is not deployed.

1. Create a Postgres database yourself and set `DATABASE_URL` to its connection string.
2. Set `PORT` if the host does not set it.
3. `npm install` and `npm start`.
4. Tables are created on startup from `server/migrations`.
5. Leave the contest variables unset until the rules, prizes, timezone, and dates are real.

There is no production database configured in this workspace. Without `DATABASE_URL` the process exits. It does not pretend a global board is live.

## Embed

```html
<iframe src="https://example.com/" title="Snibbu the Crab — Cross the Chop" width="480" height="860" style="border:0; max-width:100%"></iframe>
```

The iframe origin has to be the Node server if scores should reach the shared board.

## Tests

```bash
npm test
```

Physics tests cover levels 1, 2, 50, 98, and 99, victory, and restart. Server tests use a local Postgres database: two clients, a restart, a forged score, a duplicate submit, and a closed contest.

## Art

The player sprite is the owner's tuxedo Snibbu, cropped, drawn with `drawImage` each frame. Candles and bids are drawn in the canvas.
