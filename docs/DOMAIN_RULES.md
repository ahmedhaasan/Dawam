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

Matching is calculated without changing raw rows. Device state flags (IN/OUT) are ignored because face-device flags are not reliable.

1. Group punches per employee, sort by physical instant, and drop exact duplicate instants from calculation. Then debounce: keep the first punch and ignore each later punch occurring within 300 seconds of the previous **kept** punch. Ignored rows remain visible in the calculated result as duplicates.
2. IN is the first kept punch in `[in_from, in_to]`.
3. Once IN exists, an OUT candidate is any kept punch more than 5 minutes after IN and no later than `out_zone_end`. The normal checkout zone opens at `end - checkout_open_before_end_min`, but an earlier candidate is accepted so early leave is measurable.
4. If `out_to_min` is set, `out_zone_end = out_to`. If it is NULL, `out_zone_end = min(next shift instance in_from, end + ot_cap_min)`. An open-ended zone must never consume the next instance's IN.
5. OUT is the last eligible candidate after IN. A punch may be used by only one instance. Overnight OUT belongs to the shift start/IN date.
6. Manual corrections override calculated IN/OUT per field and require audit; raw punches remain immutable.
7. Hours = OUT − IN when both exist and OUT > IN. If the stay is under 180 minutes, add `SHORT_STAY` and require review.
8. Late minutes are whole elapsed minutes from scheduled start only when `IN > start + late_grace_min`; otherwise zero. Seconds are truncated. Early leave is `max(0, end − OUT)`. Overtime is `max(0, OUT − end)`.
9. Always return scheduled start/end and actual IN/OUT when available. Kept punches that are neither matched nor inside a relevant zone remain in REVIEW.
10. Template/assignment validation rejects an open-ended OUT configuration whose capped zone overlaps the same employee's next IN window.

## 4. Statuses per scheduled shift instance

Evaluate in order:

1. Override rest / weekly rest (no coverage) → REST
2. Coverage needed → COVERAGE_NEEDED
3. Approved leave → LEAVE; permission → PERMISSION (attendance data still shown)
4. IN and OUT → PRESENT immediately (late/early/overtime computed), even when now is before the OUT-zone end; `SHORT_STAY` adds review without discarding the actual punches
5. Incomplete shift and now < OUT window end → NOT_CLOSED (the UI describes this as waiting for checkout/import)
6. Window not fully covered by confirmed import coverage → PENDING_IMPORT
7. IN only → MISSING_OUT; OUT only → MISSING_IN
8. none → ABSENT
   Punches exist outside windows and none matched → add flag REVIEW.

## 5. Import coverage (absence safety)

- `import_coverage` stores confirmed intervals [from,to] (local). Merge overlapping/adjacent intervals.
- A shift instance is _covered_ iff [IN window start, OUT window end] ⊆ union of confirmed intervals.
- Empty file, partial export, or unconfirmed coverage ⇒ never ABSENT; use PENDING_IMPORT.
- A file's min/max punch times are suggestions only; user confirms coverage dates in the import wizard.

## 6. Month summary

Total late minutes = Σ actual late minutes. Total overtime minutes = Σ overtime minutes. Counts per status and missing-punch days are listed. The overtime list contains date, scheduled end, actual OUT, and minutes for every positive-overtime date. Overnight shifts belong to their start/IN date even when OUT is in the next day or month; if import coverage for the next-month zone is missing, status remains PENDING_IMPORT.

## 7. Payroll and money

- minor = piastres (EGP×100). `dailyWageMinor = round_half_up(monthlyMinor / basisDays)`; keep exact rational internally for hourly derivations, round only at per-date result.
- Hourly basis: `hourlyBasis = scheduledShiftHours` (default; D-06) or fixed number. Rate/min = daily / (hoursBasis×60).
- Each date: `billableUnits`, `amountMinor` computed independently; rounding half-up per date; then summed.
- Late minutes after grace feed policies. Grace mode (D-07 default `threshold`): late ≤ grace → 0 deduction; late > grace → all minutes count. Alternative `subtract`.
- Cap per date default = 1 daily wage; configurable (null = none).
- Absence deduction separate line: `absenceDays × dailyWage × multiplier` (default multiplier 1, D-08).
- Net = base salary − Σ selected lateness deductions − Σ selected absence deductions + Σ selected overtime bonuses − Σ other approved deductions. Never negative-clamped silently; show warning.

### Payroll v2 month configuration

All money is manager-entered and stored as integer piastres. Configuration JSON is versioned. Legacy policy IDs continue to load: `day_any_lateness` maps to `full_day_any`, `day_at_threshold` maps to `full_day_threshold`, and `hourly_rounded_up` maps to `hours` with a one-minute threshold.

For one date let `L` be truncated late minutes after the attendance engine, `O` overtime minutes, `D` the rounded daily wage, and `G` the configured grace. The month lateness rule is one of:

| method | per-date calculation |
| --- | --- |
| `none` | 0 |
| `minutes` | `round_half_up(hourlyAmount × L / 60)` |
| `hours` | `L≤G → 0`; `G<L<threshold → shortAmount`; otherwise `ceil(L/60) × hourlyAmount` |
| `full_day_any` | `L>G → D`, otherwise 0 |
| `full_day_threshold` | `L≥threshold → D`, otherwise 0 |
| `custom_amount` | manager-entered amount with a required audited reason |

A date defaults to `follow_month_rule`; its explicit method overrides the month rule. The default per-date cap is one daily wage and is configurable. Confirmed absence is always a separate line (`D × absence multiplier`) and is never also charged as lateness. Rest and unconfirmed/pending dates are inert.

The overtime rule is separately selected and defaults to `none`:

| method | per-date calculation |
| --- | --- |
| `none` | 0 |
| `fixed_per_hour` | if `O<minimum`, 0; otherwise round counted minutes as exact, down to 30, or down to 60, then `round_half_up(rate × counted / 60)` |
| `extra_days` | `round_half_up(D × O / (hoursPerExtraDay × 60))`; fractional days remain visible |

Per-date overtime overrides are allowed only with a reason. Every date is rounded independently before month totals. A row may be excluded from the proposed payroll without altering attendance; excluded rows contribute zero to the preview totals.

### Payroll day overrides and shared prices

The normal day table has two independent selectors. Deduction choices are `follow_month`, `none`, `minutes`, `hours`, `full_day`, and `custom_amount`. Overtime-bonus choices are `follow_month`, `none`, `per_hour`, `as_work_days`, and `custom_amount`. `follow_month` resolves to the month default; an explicit day method wins without copying any price into the day record.

All calculations read one shared month-price configuration: late-hour price H, started-hour threshold T, short-lateness amount S, full-day threshold X, daily wage D (read-only salary/basis result), overtime-hour price R, minimum overtime minutes M, overtime rounding, and overtime hours per extra day K. Changing H therefore changes all dates using `minutes`, `hours`, or a month default that resolves to either method. The equivalent rule applies to R and K for overtime dates.

`custom_amount` stores an integer-piastre amount and requires a non-empty audited reason. Other explicit overrides may store an optional note. Confirmed absence rows are inert in both selectors because absence is priced only by the separate absence line. Payroll preview totals are the sum of all per-date results plus the separate absence and approved-item lines; the summary must never use a second independent calculation path.

Payroll reporting keeps total late minutes and charged dates as separate facts. For `full_day_any`, every included non-absence date with lateness beyond grace is charged one daily wage; for `full_day_threshold`, only dates reaching the threshold are charged. The configured hourly price is not used by either full-day method. The UI must therefore describe a full-day total as `charged dates × daily wage`, while minute/hour methods describe the applicable shared hourly-price formula.

### Payroll v2 executable vectors

With `D=20000`, hourly lateness amount `H=10000`, hour threshold `30`, short amount `2500`, overtime rate `6000`, and no grace: hours lateness `[0,25,29,30,35,60,61,130]` produces `[0,2500,2500,10000,10000,10000,20000,30000]`; `full_day_any(1)=20000`; `full_day_threshold(59,60)=[0,20000]`; `minutes(30)=5000`. Fixed overtime with a 15-minute minimum produces `O=14→0`, `49→4900`, `71→7100`. Extra-days at 12 hours produces `O=360→10000`. Two separate 30-minute dates under `hours` produce two separate 10000 deductions.

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

Approved payroll stores policy snapshot + input snapshot + every per-date method, inputs, deduction, bonus, inclusion flag, edited flag, and reason. Later edits to policy/schedule/employee never change it. Void + re-approve only.

## 9. Explicit destructive administration

- Deactivation is the normal reversible employee action. Permanent purge is exceptional: admin only, non-empty reason, and exact device User ID typed as confirmation. The confirm dialog first shows the per-table counts that will be removed. If the employee is still active, the purge deactivates them first inside the same transaction and writes an `employee.deactivated` audit record before `employee.purged` (whose `before` lists the removed counts).
- Purge transactionally deletes employee-owned assignments, weekly rest, overrides, teammate links, leaves, raw punches for the device ID, quarantine rows/resolution links for the device ID, corrections, payroll runs, ignored-device state, and the employee row. Import batches and coverage records remain as file-level evidence. The same device ID may then be imported and registered as a new employee.
- Audit rows are immutable during ordinary operation. A deliberate history reset is a separate administrator danger action requiring a reason and typed confirmation. It temporarily removes only the delete guard, clears the old chain, restores the guard, and appends `audit.history_reset` as the first entry of a fresh valid chain with the deleted-row count.
