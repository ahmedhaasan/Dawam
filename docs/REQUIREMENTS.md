# Requirements

Priority: **M** must, **S** should, **C** could. IDs are stable; reference them in commits and tests.

## 1. Platform & access

- PLT-1 (M) Offline Windows 10/11 desktop app (Electron). No internet needed at runtime.
- PLT-2 (M) Arabic RTL default; English LTR switchable at runtime and persisted. Numbers/dates format correctly in both.
- PLT-3 (M) Single office PC, local SQLite. Shared multi-PC backend is out of scope for v1 (see DECISIONS D-12).
- PLT-4 (M) Database and photos live outside the install folder (`%APPDATA%\Dawam`), surviving upgrades.
- PLT-5 (M) Backup and restore (DB + photos + settings), verified round trip.

## 2. Accounts & permissions

- ACC-1 (M) First-run wizard creates the first administrator.
- ACC-2 (M) Roles: `admin`, `user`. Admins manage accounts, grant/revoke admin, payroll, policies, backups.
- ACC-3 (M) Users (non-admin) can view attendance and run imports only if granted; cannot see salaries or payroll.
- ACC-4 (M) Employee records are separate from login accounts.
- ACC-5 (S) Password change, lockout after repeated failures, optional auto-lock on idle.

## 3. Employees

- EMP-1 (M) Fields: full name, unique device User ID (string), photo, active flag, hire date, monthly salary (admin only), wage basis days (default 30, editable).
- EMP-2 (M) Duplicate device User ID rejected. Deactivating keeps history.
- EMP-3 (S) Photo crop/resize on upload; stored as file, referenced by path.
- EMP-4 (M) An administrator can permanently purge an active or inactive employee after entering a reason and typing the exact device User ID. The transaction removes all employee-owned schedules, attendance punches, corrections, resolved quarantine links, payroll runs, and ignored-ID state so that the same device ID can later be imported and added again as new.

## 4. Shifts & scheduling

- SCH-1 (M) Shift templates with official start/end and separate IN/OUT punch windows (minute offsets from shift start date midnight, supports next-day).
- SCH-2 (M) Seed: Morning 10:00–22:00 (IN 09:40–11:00, OUT 21:40–23:00); Evening 13:00–01:00+1 (IN 12:40–14:00, OUT 00:40–02:00+1). All editable; more shifts allowed.
- SCH-3 (M) Assign templates to employees by date range. Changing future schedule never alters past/approved results.
- SCH-4 (M) Individual weekly rest day per employee, date-ranged.
- SCH-5 (M) Dated overrides (change shift, force rest, force work) with reason; override beats all rules.
- SCH-6 (M) Teammate pairs: when one is on rest, the other automatically works the merged shift (earliest start, latest end, matching windows). Calendar labels it "Coverage". Both off → "Coverage needed" flag. Dated override can cancel coverage.
- SCH-7 (S) Calendar view per month with colours/labels for shift, rest, coverage, leave, override.

## 5. Attendance import

- IMP-1 (M) Home-page import of USB file exported from the device (Download Attlog). Native format enabled only after verification against a real export (IMPORT_FORMATS.md).
- IMP-2 (M) Raw punches stored untouched. Unmatched device IDs go to quarantine with a resolve flow.
- IMP-3 (M) Re-import is idempotent: no duplicate punches (unique key).
- IMP-4 (M) Each import records explicit **coverage period** (from/to) confirmed by the user; default derived from file but flagged as unconfirmed.
- IMP-5 (M) Import summary: rows, new, duplicates, quarantined, out-of-window, malformed lines with line numbers.
- IMP-6 (S) Generic CSV/JSON import with column mapping for fallback/testing.
- IMP-7 (M) File preview clearly distinguishes a raw-punch sample from grouped unknown IDs and explains why only a sample of device IDs is shown.

## 6. Monthly attendance

- ATT-1 (M) Per employee/month table: date, scheduled shift, first accepted IN, last accepted OUT, hours, late min, early-leave min, status.
- ATT-2 (M) Overnight OUT belongs to the shift start date.
- ATT-3 (M) Statuses: REST, LEAVE, PERMISSION, PRESENT, MISSING_IN, MISSING_OUT, ABSENT, PENDING_IMPORT, NOT_CLOSED, COVERAGE_NEEDED, NO_SCHEDULE, REVIEW (punches outside windows).
- ATT-4 (M) ABSENT only for a scheduled, closed shift with confirmed import coverage (DOMAIN_RULES §5).
- ATT-5 (M) Month summary: total actual late minutes, counts per status.
- ATT-6 (M) Manual corrections (add/override IN/OUT, mark leave/permission) require reason and write audit. Raw punches never edited.
- ATT-7 (S) Export month table to XLSX/PDF.
- ATT-8 (M) Lateness grace is configured per shift template; an IN at or before start + grace has zero late minutes.
- ATT-9 (M) Exact duplicate punches and repeated scans within the configured 300-second debounce window are retained raw but ignored for matching and identified in the calculated result.
- ATT-10 (M) Calculate per-date overtime after scheduled end and show monthly overtime total plus dated details.
- ATT-11 (M) Always show actual IN/OUT and scheduled start/end when available, including missing-punch and review results.
- ATT-12 (M) A complete accepted IN/OUT pair is PRESENT immediately. NOT_CLOSED is used only when a shift is still open and its accepted pair is incomplete.
- ATT-13 (M) The month summary shows total accepted worked time in hours/minutes, and each completed day displays worked time in hours/minutes rather than an ambiguous decimal.

## 7. Payroll preview & approval

- PAY-1 (M) Monthly salary + editable wage basis. Example: EGP 6,000 / 30 = EGP 200/day.
- PAY-2 (M) Each date calculated independently; per-date reason, rule, rate, cap, amount.
- PAY-3 (M) Late minutes summed separately for reporting; recorded attendance preserved even when deduction = a day's wage.
- PAY-4 (M) The month rule supports no deduction, exact minutes, started hours with a threshold and short-lateness amount, full day for any lateness, full day at a configurable threshold, and a custom audited amount. A per-date override always wins.
- PAY-5 (M) Absence and unapproved days tracked and priced separately from lateness.
- PAY-6 (M) Preview shows proposed deductions total and net pay. Preview ≠ approval.
- PAY-7 (M) Approval is a separate admin action storing a snapshot (policy, inputs, result). Admin must explicitly choose policy before real results are usable.
- PAY-8 (S) Void/re-approve with reason; history kept.
- PAY-9 (M) Overtime bonus is configured separately from lateness: none, fixed amount per hour with minimum/rounding, or overtime converted to extra workdays. It is calculated and rounded independently per date.
- PAY-10 (M) The payroll preview exposes one row per scheduled date, separate lateness/absence/overtime lines, selectable rows, manager-entered per-date overrides, and a sticky live final-salary summary. Preview never writes payroll state.
- PAY-11 (M) A month-only salary override requires a reason and audit record. The administrator may explicitly choose to also update the employee's salary.
- PAY-12 (M) Selecting an employee or month automatically loads a fresh payroll preview. Each day’s deduction method is selected directly in its row without a second edit action, and table headings remain visible while scrolling.
- PAY-13 (M) The payroll day table exposes separate deduction and overtime-bonus method selectors. Both default to following the month rule and update the day result and salary summary immediately. Confirmed absence rows remain inert.
- PAY-14 (M) Per-day deduction choices are follow month, none, minutes, hours, full day, and custom amount. Per-day bonus choices are follow month, none, per hour, as work days, and custom amount. Custom amounts require a reason; all other overrides accept an optional audited note.
- PAY-15 (M) A 620px month-rules drawer opens from the payroll screen (right edge in RTL, left edge in LTR), dims the screen, and previews changes live. Shared prices are defined once for the month and are reused by every default and per-day rule. The drawer can save for one employee or all employees in the selected month, cancel, and reset edited days.
- PAY-16 (M) Payroll totals always equal the sum of the visible per-day deduction and bonus results plus the separate absence line. Changing a shared price immediately recalculates every day that follows the month rule or uses a compatible explicit method.
- PAY-17 (M) The payroll summary explains the active lateness formula with the number of charged dates. A full-day rule must be shown as `charged dates × daily wage`, never as though total late minutes were multiplied by the configured hourly price.
- PAY-18 (M) Payroll day rows identify coverage schedules, keep long localized statuses inside their own column, and visually distinguish the lateness-method and overtime-method controls without relying on position alone.

## 8. Audit

- AUD-1 (M) Append-only audit log: who, when, action, entity, before/after, reason. Hash-chained (tamper evident).
- AUD-2 (M) Viewer with filters (admin only).
- AUD-3 (M) An administrator may deliberately reset audit history only after a required reason and typed confirmation. Reset creates the first marker in a new valid hash chain; ordinary audit rows remain immutable.

## 9. Non-functional

- NFR-1 Month view for ≤100 employees renders < 1 s on a mid office PC.
- NFR-2 No data loss on crash: SQLite WAL + transactional imports.
- NFR-3 All logic reproducible: same inputs + policy snapshot = same result.
- NFR-4 Accessibility basics: keyboard navigation, readable contrast, RTL-correct icons.
- NFR-5 Local logs with no personal data beyond IDs.
- NFR-6 All screens use the bundled Cairo family, shared payroll-v2 colour/type tokens, and responsive layouts that remain usable in a resized desktop window without clipping essential controls.

## Out of scope v1

Direct device network sync (ZK protocol/ADMS), cloud, mobile, biometric template handling, multi-PC concurrent access, tax/insurance payroll.
