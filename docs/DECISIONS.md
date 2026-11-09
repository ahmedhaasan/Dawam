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

## ACCEPTED ADRs

- ADR-1 Electron + React + TypeScript: offline Windows, bilingual UI, one language across stack.
- ADR-2 Local SQLite: single-PC, durable, simple backup.
- ADR-3 Node's built-in `node:sqlite` through Electron 45 / Node 24: avoids native-addon rebuilds while providing transactions, WAL mode, and the SQLite backup API.
- ADR-4 Money as integer piastres; round half-up per date.
- ADR-6 Pure `core` package: testable without UI/DB.
- ADR-7 Raw punches immutable; corrections are overlays with audit.
- ADR-8 Absence requires confirmed import coverage.
- ADR-9 Preview and approval are separate; approval stores snapshots.

## PROPOSED

- ADR-5 Backup zip password: AES-256 via a vetted library, or OS-level protection only.
