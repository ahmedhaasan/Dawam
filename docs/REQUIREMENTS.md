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

## 6. Monthly attendance

- ATT-1 (M) Per employee/month table: date, scheduled shift, first accepted IN, last accepted OUT, hours, late min, early-leave min, status.
- ATT-2 (M) Overnight OUT belongs to the shift start date.
- ATT-3 (M) Statuses: REST, LEAVE, PERMISSION, PRESENT, MISSING_IN, MISSING_OUT, ABSENT, PENDING_IMPORT, NOT_CLOSED, COVERAGE_NEEDED, NO_SCHEDULE, REVIEW (punches outside windows).
- ATT-4 (M) ABSENT only for a scheduled, closed shift with confirmed import coverage (DOMAIN_RULES §5).
- ATT-5 (M) Month summary: total actual late minutes, counts per status.
- ATT-6 (M) Manual corrections (add/override IN/OUT, mark leave/permission) require reason and write audit. Raw punches never edited.
- ATT-7 (S) Export month table to XLSX/PDF.

## 7. Payroll preview & approval

- PAY-1 (M) Monthly salary + editable wage basis. Example: EGP 6,000 / 30 = EGP 200/day.
- PAY-2 (M) Each date calculated independently; per-date reason, rule, rate, cap, amount.
- PAY-3 (M) Late minutes summed separately for reporting; recorded attendance preserved even when deduction = a day's wage.
- PAY-4 (M) Normal UI offers: fixed EGP per late hour; one daily wage when a date reaches 60 late minutes; or no lateness deduction. The engine retains advanced policies for compatibility.
- PAY-5 (M) Absence and unapproved days tracked and priced separately from lateness.
- PAY-6 (M) Preview shows proposed deductions total and net pay. Preview ≠ approval.
- PAY-7 (M) Approval is a separate admin action storing a snapshot (policy, inputs, result). Admin must explicitly choose policy before real results are usable.
- PAY-8 (S) Void/re-approve with reason; history kept.

## 8. Audit

- AUD-1 (M) Append-only audit log: who, when, action, entity, before/after, reason. Hash-chained (tamper evident).
- AUD-2 (M) Viewer with filters (admin only).

## 9. Non-functional

- NFR-1 Month view for ≤100 employees renders < 1 s on a mid office PC.
- NFR-2 No data loss on crash: SQLite WAL + transactional imports.
- NFR-3 All logic reproducible: same inputs + policy snapshot = same result.
- NFR-4 Accessibility basics: keyboard navigation, readable contrast, RTL-correct icons.
- NFR-5 Local logs with no personal data beyond IDs.

## Out of scope v1

Direct device network sync (ZK protocol/ADMS), cloud, mobile, biometric template handling, multi-PC concurrent access, tax/insurance payroll.
