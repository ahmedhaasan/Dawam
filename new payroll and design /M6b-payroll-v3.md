Milestone "M6b Payroll v2". Read the usual preamble files, then DOMAIN_RULES §7,
UI_SPEC §11, REQUIREMENTS PAY-1..PAY-8. Order: docs -> tests -> core -> service
-> UI. Visual reference (layout only, sample data):
https://claude.ai/artifact/7fHJZgYaq3rxTesbKyaQPU
Admin only, enforced in the service layer. Arabic RTL default; verify LTR.
Depends on attendance v2 (M9a) for late/overtime minutes; hide overtime if absent.

SCREEN
Header: employee, month, recalculate. Do NOT show check-in/out on this screen.
Day table columns: date, status badge, late min, overtime min, per-day deduction
method select, deduction, bonus, edit icon. Rest days are grey and inert; a
confirmed absence shows "absence" and is priced in the separate absence line.
Second card "Month rules": two panels (deduction, overtime bonus) with editable
amounts, each with an "Apply to all days" button. Sticky summary card: base
salary (edit icon), late deduction (+ total late minutes), absence deduction,
overtime bonus (+ counted minutes), FINAL SALARY, Approve, Print.

DEDUCTION METHODS (per date; all amounts are manager inputs in piastres, no
hard-coded prices). Let L = late minutes (whole, truncated), H = hourly amount,
T = hour threshold (default 30), S = short-lateness fixed amount (default 0),
D = daily wage, G = grace (existing D-07):
- none: 0.
- minutes: round_half_up(H * L / 60).
- hours: if L<=G: 0; else if L<T: S; else ceil(L/60) * H.
   (2h10m -> 3h; 30-60 min -> 1h; 29 min -> S.)
- full_day_any: L>G -> D, else 0 (unconditional, no minimum).
- full_day_threshold(X): L>=X -> D, else 0 (existing day_at_threshold).
- custom_amount: manager-typed amount with required reason (audited).
- default "follow month rule". A per-day choice always beats the month rule.
Per-date cap: configurable, default 1 daily wage. Absence is a separate line
(DOMAIN_RULES §7) and uses D x multiplier; it is never also counted as lateness.

OVERTIME BONUS METHODS (per date; O = overtime minutes after attendance v2):
- fixed_per_hour: amount R (manager input), minimum minutes M (default 15),
  rounding: exact minutes | down to 30 | down to 60. bonus = R * counted/60.
- extra_days: bonus = D * (O / (K*60)) where K = overtime hours per extra day
  (default = scheduled shift hours); show fractional days; round half-up per date.
- none. Per-day override allowed, with reason. Default "off" until chosen.

CONFIG & DATA
- Extend policy config JSON (versioned): lateRule {method, H, T, S, X, capPerDay},
  overtimeRule {method, R, M, rounding, K}. Keep existing policies working;
  map day_any_lateness -> full_day_any, day_at_threshold -> full_day_threshold,
  hourly_rounded_up -> hours with T=1. Migration 0003 only if schema changes.
- Approval stores policy + inputs + per-date result snapshots (ADR-9): per date
  store method used, inputs, deduction, bonus, edited flag, reason.
- Editing base salary on this screen changes only this month's payroll input
  (reason + audit); a checkbox may also update the employee record.
- Net = base - late - absence + bonus; warn if negative, never clamp silently.

TEST VECTORS (daily 200 EGP = 20000 piastres, H=100 EGP = 10000, T=30, S=25 EGP):
L=0->0; L=25->2500; L=29->2500; L=30->10000; L=35->10000; L=60->10000;
L=61->20000 (2h); L=130->30000 (3h); full_day_any L=1->20000; L=0->0;
full_day_threshold(60): L=59->0, L=60->20000; minutes L=30->5000.
Overtime fixed R=60 EGP, M=15: O=14->0; O=49->4900; O=71->7100.
extra_days K=12: O=360 -> 10000 (half a day).
Independence: two dates x 30 min under hours => 2 x 10000 (rounding per date).
Also: per-day override beats month rule; unticked/edited rows; salary edit audited;
non-admin IPC denied; approval immutable under later edits.
Report real test output and RTL+LTR screenshots. Update IMPLEMENTATION.md.
