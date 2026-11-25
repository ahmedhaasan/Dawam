# Test plan

## 1. Layers

- Unit (Vitest): `core`, importers, services with in-memory SQLite.
- Integration: services + real SQLite file + migrations; IPC handlers with role matrix.
- E2E (Playwright-Electron): first-run, import, calendar, month view, payroll preview/approve, backup/restore.
- Manual on target Windows PC: installer, upgrade, visual RTL/LTR.

## 2. Required unit scenarios (core)

Time: DST start/end nights, overnight crossing month and year, seconds truncation, ambiguous local time flagged.
Schedule: precedence order; weekly rest; override beats coverage; coverage merge windows; both off; pair validity range; no recursion.
Matching: first IN / last OUT; punch reuse prevented; outside window → REVIEW; manual correction overrides; OUT-before-IN ignored.
Status: each status in DOMAIN_RULES §4, including partial import and not-closed shift, complete pair before OUT-zone end ⇒ PRESENT, empty file ⇒ no ABSENT.
Payroll: 0/1/30/59/60/61 per policy; grace both modes; cap on/off; two dates × 30 min; tiers (overlap rejected); basis days ≠ 30; hourly basis variants; absence separate; net negative warning; rounding half-up edge (x.5).

## 3. Acceptance scenarios (end-to-end, synthetic data)

S1 Morning employee punches 09:55/22:05 → PRESENT, 0 late, hours 12:10.
S2 Evening employee punches 12:50 / 01:10 next day → OUT belongs to start date; hours ≈ 12:20.
S3 Late 10:20 → late 20, status PRESENT-with-late, preview per policy.
S4 No punches, coverage confirmed → ABSENT; same day with unconfirmed coverage → PENDING_IMPORT.
S5 Only IN → MISSING_OUT.
S6 A on rest → B gets merged shift 10:00–01:00+1; label Coverage; both rest → COVERAGE_NEEDED.
S7 Dated override on coverage day → coverage cancelled, audit entry exists.
S8 Re-import same file → 0 new; overlapping file → only new rows.
S9 Month-end overnight shift with next-month export missing → PENDING_IMPORT.
S10 Approve payroll then edit policy/schedule → approved run unchanged.
S11 Non-admin tries payroll/users/backup IPC → denied.
S12 Backup → delete DB → restore → all data and photos present.
S13 Select a different payroll employee/month → day rows and summary load without pressing Recalculate; edit opens directly below the selected date.
S14 Deactivate employee, type the exact device ID, and purge → every employee-owned record is gone; re-import surfaces that device ID as new/unmatched.
S15 Reset audit with wrong confirmation → rejected; correct confirmation + reason → one valid reset marker begins a new chain.
S16 Resize the desktop window to 1024×700 in Arabic and English → navigation, forms, import dialog, attendance table, and payroll remain usable without page-level horizontal clipping.

## 4. Security tests

IPC fuzz with malformed payloads; role matrix; SQL injection strings in names/search; path traversal in photo path/restore zip; audit tamper detection; password lockout; zip bomb/size limits on restore/import (e.g. >50 MB rejected).

## 5. Release checklist (record result + date in IMPLEMENTATION.md)

[ ] Clean install on target PC [ ] Upgrade keeps data [ ] First-run admin [ ] Restart persistence
[ ] Arabic RTL and English LTR all screens [ ] Real device export imports (fixture verified)
[ ] Repeat import idempotent [ ] Overnight and month-boundary [ ] Weekly rest + teammate coverage
[ ] Payroll vectors UI = core [ ] Approval immutability [ ] Non-admin restrictions
[ ] Backup/restore round trip [ ] Audit chain verify [ ] Performance NFR-1 [ ] No real data in repo/logs

## 6. CI-like script

`pnpm check` = lint + typecheck + unit + integration. `pnpm e2e` on Windows. Coverage thresholds: core ≥95%, importers ≥90%, services ≥80%.
