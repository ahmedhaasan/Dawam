# Domain rules (source of truth for `packages/core`)

Terms: **shift instance** = (employee, shift start date, template). **Window** = accepted punch interval. Time zone `Africa/Cairo`.

## 1. Time representation

- Punch: `punched_at_local` = `YYYY-MM-DD HH:mm:ss` wall-clock as exported. Convert with Luxon zone for arithmetic.
- Template times are minute offsets from midnight of the shift start date (can exceed 1440). Evening: start 780, end 1500, IN 760–840, OUT 1480–1560(…2 h = 120 → 1560).
- Durations computed in real elapsed time (DST-safe). Ambiguous/non-existent local times resolved deterministically (earlier offset) and flagged in REVIEW.
- Lateness/early-leave: whole minutes, seconds truncated (D-05 default). Example: IN 10:00:59 with start 10:00 → 0 late; 10:01:00 → 1.

## 2. Resolving a day's schedule (precedence, high → low)

1. Dated override (shift / rest / work).
2. Approved leave/permission (status layer, still shows scheduled shift).
3. Teammate coverage: if employee has a pair and partner is on rest that date (by rules below) and employee is not on rest → merged shift.
4. Weekly rest day → REST.
5. Assignment valid on that date → template.
6. Otherwise NO_SCHEDULE.
   Coverage: both off (neither override-working) → COVERAGE_NEEDED for both dates. Merged shift = start of earlier-starting template, end of later-ending template, IN window of the earlier-start template, OUT window of the later-end template. A dated override cancels coverage for that employee/date.
   Partner "rest" is evaluated from steps 1,4 (not from coverage itself — no recursion).

## 3. Punch matching

For shift instance with windows IN=[a,b], OUT=[c,d] (absolute datetimes):

- IN = earliest punch in [a,b]. OUT = last punch in [c,d].
- Device state flags (in/out) are ignored for matching (face devices unreliable).
- Punch used by one instance cannot be reused by another. Windows of adjacent days must not overlap (validate on template save; reject overlapping windows for same employee).
- Punches belonging to no window → REVIEW list (not discarded).
- Manual corrections override matching result per field, with audit.
- Hours = OUT − IN if both exist and OUT > IN, else null.
- Late = max(0, IN − start). Early = max(0, end − OUT). Both only if the respective punch exists.

## 4. Statuses per scheduled shift instance

Evaluate in order:

1. Override rest / weekly rest (no coverage) → REST
2. Coverage needed → COVERAGE_NEEDED
3. Approved leave → LEAVE; permission → PERMISSION (attendance data still shown)
4. Shift not closed (now < OUT window end) → NOT_CLOSED
5. Window not fully covered by confirmed import coverage → PENDING_IMPORT (unless complete pair exists → PRESENT)
6. IN and OUT → PRESENT (late/early computed)
7. IN only → MISSING_OUT; OUT only → MISSING_IN
8. none → ABSENT
   Punches exist outside windows and none matched → add flag REVIEW.

## 5. Import coverage (absence safety)

- `import_coverage` stores confirmed intervals [from,to] (local). Merge overlapping/adjacent intervals.
- A shift instance is _covered_ iff [IN window start, OUT window end] ⊆ union of confirmed intervals.
- Empty file, partial export, or unconfirmed coverage ⇒ never ABSENT; use PENDING_IMPORT.
- A file's min/max punch times are suggestions only; user confirms coverage dates in the import wizard.

## 6. Month summary

Total late minutes = Σ late (actual). Counts per status. Missing-punch days listed. Overnight shift on last day of month belongs to that month even if OUT is next month; if import coverage for the next-month window is missing → PENDING_IMPORT.

## 7. Money

- minor = piastres (EGP×100). `dailyWageMinor = round_half_up(monthlyMinor / basisDays)`; keep exact rational internally for hourly derivations, round only at per-date result.
- Hourly basis: `hourlyBasis = scheduledShiftHours` (default; D-06) or fixed number. Rate/min = daily / (hoursBasis×60).
- Each date: `billableUnits`, `amountMinor` computed independently; rounding half-up per date; then summed.
- Late minutes after grace feed policies. Grace mode (D-07 default `threshold`): late ≤ grace → 0 deduction; late > grace → all minutes count. Alternative `subtract`.
- Cap per date default = 1 daily wage; configurable (null = none).
- Absence deduction separate line: `absenceDays × dailyWage × multiplier` (default multiplier 1, D-08).
- Net = salary − Σ lateness − Σ absence − Σ other approved items. Never negative-clamped silently; show warning.

### Policies (config schema in core, versioned)

| id                   | rule                               |
| -------------------- | ---------------------------------- |
| none                 | 0                                  |
| fixed_hourly_amount  | late minutes × configured EGP/hour |
| hourly_proportional  | late × (daily / (hours×60))        |
| hourly_rounded_up    | ceil(late/60) × (daily / hours)    |
| day_per_started_hour | ceil(late/60) × daily (capped)     |
| day_any_lateness     | late>0 → 1 daily                   |
| day_at_threshold     | late ≥ T → 1 daily else 0          |
| custom_tiers         | list of {fromMin,toMin,amountMinor | fractionOfDaily} first match wins; tiers must not overlap |

### Test vectors (daily 20000 piastres = EGP 200, hours basis 12, no grace, cap 1 day, half-up)

| late min                                                                                                                                      | hourly_proportional | hourly_rounded_up | day_per_started_hour (cap 1d) | day_any | threshold 60 |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------- | ----------------------------- | ------- | ------------ |
| 0                                                                                                                                             | 0                   | 0                 | 0                             | 0       | 0            |
| 1                                                                                                                                             | 28                  | 1667              | 20000                         | 20000   | 0            |
| 30                                                                                                                                            | 833                 | 1667              | 20000                         | 20000   | 0            |
| 59                                                                                                                                            | 1639                | 1667              | 20000                         | 20000   | 0            |
| 60                                                                                                                                            | 1667                | 1667              | 20000                         | 20000   | 20000        |
| 61                                                                                                                                            | 1694                | 3333              | 20000 (cap; 40000 uncapped)   | 20000   | 20000        |
| Independence: two dates × 30 min ⇒ rounded_up = 1667+1667 = 3334 (not 1667); proportional = 833+833 = 1666; total late minutes reported = 60. |
| These vectors are illustrative until D-06/07 are confirmed; they are executable fixtures in `packages/core/tests/fixtures/payroll.json`.      |

## 8. Immutability

Approved payroll stores policy snapshot + input snapshot + per-date result. Later edits to policy/schedule/employee never change it. Void + re-approve only.
