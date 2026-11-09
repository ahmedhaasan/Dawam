# AGENTS.md — rules for any AI coding agent on this repo

## Start every session

1. Read `README.md`, `docs/REQUIREMENTS.md`, `docs/DOMAIN_RULES.md`, `docs/PLAN.md`, and the latest `IMPLEMENTATION.md` entries.
2. Identify the current milestone (first one in PLAN.md not marked DONE). Work only on it unless told otherwise.
3. If a rule is ambiguous or listed in `docs/DECISIONS.md` as OPEN, do NOT guess silently: implement it as configuration with the documented default, and note it in IMPLEMENTATION.md.

## Hard rules

- Domain logic (`packages/core`) is pure TypeScript: no Electron, no DOM, no SQLite, no `Date.now()` (inject a clock). Fully unit-tested.
- Money is integer minor units (piastres) only. Never floats for money. Rounding happens per date, half-up, explicitly.
- Times: device punches are local wall-clock (Africa/Cairo). Store the raw string, never mutate raw punches. Use Luxon with explicit zone. Egypt observes DST — test overnight shifts across transitions.
- Device user IDs are strings. Never parse to number.
- Absence is NEVER inferred from missing data unless import coverage is confirmed (see DOMAIN_RULES §5).
- Renderer has no Node access (contextIsolation on, nodeIntegration off). Every IPC handler validates input (zod) and checks role in the main process.
- Every state change that affects attendance or payroll writes an audit record in the same DB transaction.
- Use synthetic data only. Never commit real employee data, photos, DBs, backups, or logs (see `.gitignore`).
- Don't claim LX50/ZKTeco format compatibility until a real export fixture is committed (sanitized) and passing.

## Definition of done (every task)

- Code + tests written; `pnpm lint && pnpm typecheck && pnpm test` pass (run them, report actual output summary).
- UI strings exist in both `ar` and `en`; layout checked RTL and LTR.
- `IMPLEMENTATION.md` updated: date, what changed, validation actually run, blockers. Unrun checks are listed as PENDING.
- No unrelated refactors. Small commits with clear messages.

## Conventions

- pnpm workspace: `packages/core`, `packages/db`, `apps/desktop` (Electron main + preload + React renderer).
- English identifiers/comments; user-visible text via i18n keys only.
- Migrations are forward-only SQL files, numbered `0001_*.sql`.
- Errors in core are typed results (`Result<T,E>`), not thrown strings.
- Prefer boring, well-known libraries. Ask before adding a dependency with native modules.

## When blocked

Stop, write the question in `docs/DECISIONS.md` under OPEN, add a line to IMPLEMENTATION.md, continue with unblocked work.
