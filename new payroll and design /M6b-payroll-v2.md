Milestone "M6b Payroll screen v2". Depends on M9a (overtime). Read the usual
preamble files, DOMAIN_RULES §7, UI_SPEC §11, REQUIREMENTS PAY-1..PAY-8. Docs first
(UI_SPEC §11, DOMAIN_RULES §7, DECISIONS), then tests, then code. Arabic RTL default,
check LTR too. Visual reference (layout and hierarchy only, do not copy its sample
data): https://claude.ai/artifact/SroX5sjbwyzfENt23G1jFR

SCREEN (admin only, enforced in the service layer)
Header: employee picker, month picker, recalculate. KPI strip: days present, absent,
total late minutes, total overtime minutes.
Main column, two tabs:
 A. Day list, one row per scheduled date: status, actual in, actual out, late min,
    overtime min, per-day method, deduction, bonus, edit icon (tooltip + aria-label).
    Rest days are non-interactive; confirmed absence shows its own badge and amount.
    Per-day methods: month rule | none | per minute | per half-hour | per started hour |
    full day | custom amount. A per-day choice beats the month rule and shows an
    "edited" mark.
 B. Month rules, two groups, each with "Apply to all days":
    LATE: (1) hourly with threshold T (default 30): late < T -> flat amount F;
    late >= T -> ceil(late/60) hours x hourly amount. (2) full day for EVERY late day,
    no minimum (late > 0). (3) full day when late >= threshold. (4) per minute =
    hourly/60 x minutes. (5) none.
    OVERTIME BONUS: (1) fixed amount per overtime hour, with minimum minutes
    (default 15) and rounding (actual minutes | half-hour down | hour down).
    (2) overtime as workdays: every H overtime hours (default 12) = 1 daily wage.
    (3) none.
    All amounts and thresholds are manager-entered, integer piastres.
Summary column (sticky): base salary with edit icon, late deduction (with total
minutes), absence deduction (days), overtime bonus (minutes), a "to be applied" list
(each deduction a checkbox; unticked rows are excluded from totals), prominent FINAL
SALARY box, Approve (confirm dialog with snapshot, ADR-9) and Print.

RULES
- Preview never saves. Approval stores policy + inputs + per-date results snapshot.
- Money is integer piastres, half-up rounding per date, never floats.
- Absence only for confirmed import coverage (ADR-8).
- Base-salary edit changes only this month's payroll input (required reason, audited),
  not the employee record, unless the user picks "also update employee salary".
- Overtime comes from M9a; if M9a is not done, hide the bonus group.
- final = base - late - absence + bonus (only ticked rows).

TESTS (write first)
Hourly rule: 25 min -> 25; 35 min -> 100; 130 min -> 300 (3 hours); 29 -> 25; 30 -> 100.
Full day for every late day: 1 min -> 1 daily wage. Per-day override beats month rule.
Overtime: 49 min at 60/h -> 49; 10 min with minimum 15 -> 0; 12 h = 1 workday.
Unticked row excluded from totals. Salary edit audited. Non-admin IPC denied.
Report real test output and attach RTL and LTR screenshots.

DESIGN REFERENCE (mandatory)
Before any UI work read docs/design/DESIGN_TOKENS.md and docs/design/payroll-v2-mockup.html.
Match their font sizes, weights, colors, radii, spacing and layout structure.
1. Turn the tokens into CSS variables in ONE shared theme file, and use them in the
   payroll screen. Do not hard-code colors or sizes in components.
2. Bundle the Cairo font locally (the app is offline). No Google Fonts link.
3. Do not copy the mockup markup or its sample data. Rebuild it in our React
   components.
4. Then apply the same tokens to the other screens (monthly attendance, home, import)
   under M9b, so the whole app uses one look. Replace any white-on-light text.
5. Run a WCAG AA contrast check on every color pair in the tokens file, fix failures,
   and report the results.
6. Screenshot RTL and LTR for every screen you changed.
