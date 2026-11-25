# Decisions

## OPEN — owner must answer (defaults let development continue; all are configuration, not hard-coded)

| ID   | Question                                                                                   | Default used meanwhile             |
| ---- | ------------------------------------------------------------------------------------------ | ---------------------------------- |
| D-01 | Exact eFace 10 firmware/version? Raw six-column DAT bytes verified 2026-11-09; version unknown | DAT verified; XLS unverified     |
| D-02 | Controlled known IN/OUT + overnight export (optional follow-up)                             | Current random-punch file verifies parsing |
| D-03 | Week start day and official weekend                                                        | Saturday start; rest per employee  |
| D-04 | Deduction policy to use in production                                                      | Admin chooses fixed EGP/hour, or 1 day when a date reaches 60 late minutes |
| D-05 | Late minutes: truncate seconds or round up?                                                | Truncate                           |
| D-06 | Hourly rate basis: shift length (12h) or fixed 8h?                                         | Scheduled shift hours              |
| D-07 | Grace: threshold (all-or-nothing) or subtract? Grace minutes?                              | threshold, 0 min                   |
| D-08 | Absence deduction multiplier (1 day? more?)                                                | 1.0                                |
| D-09 | Cap per date and per month                                                                 | Threshold policy is max 1 daily wage per affected date |
| D-10 | Early-leave deducted like lateness?                                                        | Reported, not deducted             |
| D-11 | Public holidays / approved leave balances                                                  | Manual leave entries only          |
| D-12 | Need more than one PC to use data at same time?                                            | No (single PC)                     |
| D-13 | Backup encryption password required?                                                       | Optional                           |
| D-14 | Does the evening shift's weekly rest day conflict with coverage rules for 3+ person teams? | Pairs only                         |
| D-15 | Monthly cutoff: calendar month or custom payroll cycle?                                    | Calendar month                     |
| D-16 | Should lateness grace vary by shift template?                                              | Per template; 0 minutes            |
| D-17 | How should repeated biometric scans be debounced?                                          | Keep first scan; ignore next 300 s |
| D-18 | When may a post-IN punch count as an early OUT, and when is a stay suspiciously short?      | More than 5 min after IN; flag stays under 180 min |
| D-19 | How long may an open-ended OUT zone remain open, and when should normal checkout begin?     | Cap at 480 min overtime; checkout opens 10 min before end |

## ACCEPTED ADRs

- ADR-1 Electron + React + TypeScript: offline Windows, bilingual UI, one language across stack.
- ADR-2 Local SQLite: single-PC, durable, simple backup.
- ADR-3 Node's built-in `node:sqlite` through Electron 45 / Node 24: avoids native-addon rebuilds while providing transactions, WAL mode, and the SQLite backup API.
- ADR-4 Money as integer piastres; round half-up per date.
- ADR-6 Pure `core` package: testable without UI/DB.
- ADR-7 Raw punches immutable; corrections are overlays with audit.
- ADR-8 Absence requires confirmed import coverage.
- ADR-9 Preview and approval are separate; approval stores snapshots.
- ADR-10 Payroll v2 uses one versioned month configuration with independent lateness and overtime rules; per-date overrides always win and are snapshotted.
- ADR-11 Payroll preview does not repeat actual IN/OUT; monthly attendance remains the source for punch details.
- ADR-12 Payroll calculations round half-up per date, keep absence separate, and never clamp a negative final salary.
- ADR-13 Salary edits from payroll are month-only by default; updating the employee salary is a separate explicit audited choice.
- ADR-14 A complete accepted IN/OUT pair is PRESENT immediately, even while the configured OUT zone remains open. NOT_CLOSED is only a waiting state for an incomplete shift.
- ADR-15 Permanent employee removal is an explicit administrator purge: the employee must be inactive, the device ID must be typed as confirmation, and all employee-owned attendance, schedule, payroll, correction, quarantine-resolution, and ignored-ID records are removed transactionally.
- ADR-16 Audit history may be reset only from the administrator danger zone with a typed confirmation and reason. The old chain is deleted deliberately and a new chain starts with an `audit.history_reset` marker containing only the deleted-row count.
- ADR-17 Cairo is the single application typeface. The payroll-v2 design tokens, readable weights, status colours, and responsive card/table structure are the visual baseline for every screen.
- ADR-18 The import preview's device-ID rows are labelled as a small raw-punch sample, not as unknown employees. Unknown IDs remain grouped separately after import analysis.
- ADR-19 Payroll treats `EARLY_LEAVE` as a worked day: it counts in present days, lateness/overtime use the normal rules, and early-leave minutes are shown but not deducted (no early-leave price exists yet). `REVIEW`, `MISSING_IN` and `MISSING_OUT` are never deducted as absence; they compute on the minutes available (usually 0) and are flagged in the payroll screen for the administrator to correct attendance first. The per-minute late price is displayed as hour price ÷ 60, so the v2 configuration schema is unchanged.

## PROPOSED

- ADR-5 Backup zip password: AES-256 via a vetted library, or OS-level protection only.
