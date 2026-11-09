# Agent prompts (copy-paste; replace nothing unless noted)

## Universal preamble (prepend to every prompt)

> You are working in the Dawam repo. First read README.md, AGENTS.md, docs/REQUIREMENTS.md, docs/DOMAIN_RULES.md, docs/PLAN.md and the latest entries of IMPLEMENTATION.md. Work only on the milestone named below. Use synthetic data. Run the checks you claim to have run and report real results. Update IMPLEMENTATION.md in the same change. If something is ambiguous, apply the default in docs/DECISIONS.md and note it. Do not claim device-format compatibility without a verified fixture.

## M0

> Execute milestone M0 from docs/PLAN.md. Create the pnpm workspace layout from docs/ARCHITECTURE.md, strict TS, lint, Vitest, Electron+Vite+React skeleton, i18next ar/en with RTL/LTR switching, and `pnpm check`. Stop at the M0 gate and summarize what passed.

## M1

> Execute M1: implement `packages/core` exactly per docs/DOMAIN_RULES.md. Write tests first from the §7 vectors and the scenarios in docs/TEST_PLAN.md §2 (include DST and month-boundary cases). Core must be pure (no Electron/DB/DOM, injected clock, integer money). Report coverage numbers. Do not build UI.

## M2

> Execute M2: SQLite migrations from docs/DATA_MODEL.md, repositories, AuthService (scrypt, lockout), first-run admin wizard, role checks in services, zod-validated typed IPC, audit chain with append-only trigger. Add tests for permissions and tamper detection. Verify restart persistence.

## M3

> Execute M3: employee CRUD with photos, shift template editor with validation, assignments, weekly rest, overrides, teammate pairs, schedule calendar with Coverage / Coverage needed labels. Use `core` for every rule. Add RTL/LTR screenshots to your report.

## M4

> Execute M4: importer interface, generic CSV/JSON importers, import wizard with explicit coverage confirmation, idempotent inserts, quarantine flow, malformed report. The native ZK parser must be gated behind a verified fixture: if tests/fixtures/real/ is empty, implement the parser per docs/IMPORT_FORMATS.md as UNVERIFIED and clearly label it in UI and logs.

## M5

> Execute M5: monthly attendance service + UI per docs/UI_SPEC.md §9 and docs/TEST_PLAN.md scenarios S1–S9, corrections and leave with audit, month summary, export. Ensure ABSENT never appears without confirmed coverage.

## M6

> Execute M6: policy editor with live calculator, payroll preview with per-date explanation, explicit policy selection, separate approval with snapshots, void/re-approve. Enforce admin-only at the service layer. Prove the test vectors via both core tests and an E2E.

## M7

> Execute M7: backup (online API + photos + manifest + checksums), restore with pre-restore snapshot and integrity check, audit viewer, idle lock, log redaction, CSP review. Run the backup→wipe→restore round trip and report.

## M8

> Execute M8: NSIS installer, upgrade and clean-install tests, bilingual visual QA, two-page user manual (AR/EN), and run the release checklist in docs/TEST_PLAN.md §5, recording each result. List anything not run as PENDING.

## Review prompt (use with a second agent after each milestone)

> Review the diff for milestone Mx against docs/DOMAIN_RULES.md and docs/REQUIREMENTS.md. List: rule violations, missing tests, security issues (IPC, roles, paths), RTL/i18n gaps, money/rounding errors, and any unverified claims in IMPLEMENTATION.md. Be specific with file/line.

## Kick-off prompt for a brand-new agent (single message)

> Read README.md first and follow its read order. Then start the first milestone in docs/PLAN.md that is not DONE in IMPLEMENTATION.md, using the matching prompt in docs/AGENT_PROMPTS.md. Ask me only about items marked OPEN in docs/DECISIONS.md that block you.
