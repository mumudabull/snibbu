# Snibbu the Crab — Cross the Chop

Mobile-friendly arcade game and installable PWA, with a shared PostgreSQL
leaderboard that verifies completed runs by replaying their gameplay.

## Play and contest status

- Levels 1–99, touch D-pad and swipe controls, plus keyboard controls.
- Install from the mobile browser's home-screen menu. Personal bests persist in
  that browser; offline play is practice-only. Shared rankings and submissions
  need an internet connection.
- **Contest is disabled.** All rankings are practice-only. A display name is
  not proof of prize ownership. Do not announce dates, rules, prizes, or
  eligibility that the owner has not supplied.

## Development in Replit

This repository contains the complete Replit workspace. Open the web preview
and use its managed workflows:

- `artifacts/snibbu: web` — mobile PWA and game
- `artifacts/api-server: API Server` — validated runs and shared leaderboard

The application uses PostgreSQL. Configure `DATABASE_URL` and `SESSION_SECRET`
through the workspace's secret settings; never commit secret values. To apply
schema changes to the development database, run
`pnpm --filter @workspace/db run push`.

## Checks

```sh
pnpm install
pnpm run typecheck
pnpm --filter @workspace/scripts run test:snibbu
```

With the Replit workflows running, `pnpm --filter @workspace/scripts run
test:snibbu-browser` checks desktop and mobile input, saved mobile runs,
cross-client rankings, offline practice, and personal-best persistence.

The preserved upstream game is in `lib/snibbu-upstream/`. The Replit web
artifact syncs its original game files from there; the API adapter uses the
same replay rules against the workspace database.
