# Delivery plan

Order is deliberate: pure rules first (cheap to test), UI later. Mark milestones DONE in IMPLEMENTATION.md. Don't start Mn+1 until Mn's gate passes.

## M0 — Bootstrap (0.5–1 day)

Tasks: pnpm workspace, TS strict, ESLint/Prettier, Vitest, Electron+Vite skeleton, i18next with ar/en, CI script `pnpm check` (lint+typecheck+test), `.gitignore`, synthetic fixture folder.
Gate: `pnpm check` green; app window opens; language toggle flips RTL/LTR.

## M1 — Domain core (3–5 days)

Tasks: time utils (Luxon, DST), template/window validation, schedule resolver incl. precedence/coverage/overrides, punch matcher, status engine, import-coverage logic, month summary, payroll calculator with all 7 policies, grace/cap, absence line, money helpers.
Fixtures: DOMAIN_RULES vectors, DST week (last Friday of April / October), overnight month boundary, coverage both-off, partial import.
Gate: ≥95% line coverage on `core`; all vectors in DOMAIN_RULES §7 pass; property tests (no punch double-used, month sums = Σ days).

## M2 — Persistence, auth, shell (3–4 days)

Tasks: SQLite setup + migrations (DATA_MODEL), repositories, AuthService (scrypt, lockout), first-run wizard, session, roles, IPC skeleton with zod, audit chain + trigger, settings.
Gate: restart persistence; admin/user permission tests at service layer; audit chain verifies; tampering detected.

## M3 — Employees, shifts, scheduling (4–5 days)

Tasks: employee CRUD + photo storage, template editor, assignments, weekly rest, overrides, teammate pairs, schedule calendar with Coverage / Coverage-needed labels.
Gate: overlap validations; coverage scenarios (A off→B merged; both off→flag; override cancels); changing future schedule doesn't alter past results (test).

## M4 — Import pipeline (3–4 days, needs real file for native format)

Tasks: importer interface, JSON/CSV generic, **native ZK parser after fixture verified**, wizard, coverage confirmation, idempotent insert, quarantine UI, malformed report.
Gate: re-import = 0 new rows; overlapping exports; unknown IDs quarantined; transaction rollback on failure; native format shown "UNVERIFIED" until fixture passes.

## M5 — Monthly attendance (3–4 days)

Tasks: month service using core, table UI, detail drawer, corrections, leave/permission, summaries, filters, export (XLSX/PDF).
Gate: acceptance scenarios in TEST_PLAN §3; ABSENT never shown without confirmed coverage; overnight OUT attributed to start date; 1000-punch month < 1 s.

## M6 — Payroll preview & approval (3–4 days)

Tasks: policy editor, preview UI, per-date explanation, approval flow + snapshot, void/re-approve, admin-only enforcement.
Gate: vectors pass in UI and service; two×30-minute independence; approval immutable under later edits; non-admin cannot read salaries via any IPC.

## M7 — Backup/restore, audit viewer, hardening (2–3 days)

Tasks: backup (online API + photos + manifest), restore with pre-restore snapshot, integrity check, audit viewer, idle lock, log redaction, CSP review.
Gate: backup→wipe→restore round trip on Windows restores employees, photos, attendance, payroll settings, approvals.

## M8 — Packaging & acceptance (2–3 days)

Tasks: NSIS installer, upgrade test (v0.x→v0.y keeps data), clean-install test, Arabic/English visual QA, user manual (AR/EN, 2 pages), release checklist (TEST_PLAN §5).
Gate: all release checks run on the target PC and recorded in IMPLEMENTATION.md.

## Later (not v1)

Direct device sync, multi-PC backend, XLSX payroll export for accountant, leave balances, notifications.

## Parallelism for multiple agents

After M0: Agent A = M1 (core), Agent B = M2 (db/auth) — they only share types in `packages/core/src/types.ts`. UI work (M3+) starts once both gates pass.

## Risks

| Risk                                | Mitigation                                               |
| ----------------------------------- | -------------------------------------------------------- |
| Real export differs from assumption | verify fixture first; parser behind interface            |
| DST/overnight bugs                  | DST fixtures in M1                                       |
| Absence false positives             | coverage rule, tests                                     |
| Native module build on Electron     | pin versions; CI-like local build script; ADR-3 fallback |
| Rule ambiguity in payroll           | policy as config; open decisions listed                  |
| Data loss                           | WAL, transactions, backups, restore test                 |
