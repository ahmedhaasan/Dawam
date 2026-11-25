# Dawam design tokens (source: payroll-v2-mockup.html)

Reference only. Replicate values in the app's own styling system. Do not copy the mockup markup.

## Typography
- Font: Cairo (Arabic + Latin), bundled locally (app is offline). Weights 500, 700, 800.
- Base text 17px / 500. Table body 16px. Table header 14px / 700.
- Page title h1 36px / 800. Card title h2 22px / 800. Sub-title h3 19px / 800.
- Field labels 14px / 700. Inputs 15-16px / 700. Buttons 17px / 700. Big numbers 30px (KPI), 44px (final salary), all 800.
- Rule: labels and values are bold enough to read at arm's length; never below 14px.

## Colors
- Page bg #f1f4f9 | card bg #ffffff | text #14233f | muted text #3b4a63
- Borders: card #d5dce8, input #b7c2d4, table rows #e6ebf3
- Primary #1f7a63 (button, active tab) | primary-dark #0f5a46 (text on tint, overtime/bonus) | primary tint #e3f1ed | selected option bg #eaf6f2
- Late/warning text #9a4b00 | deduction text #8a1c1c
- Status chips (bg / text): green #dff3ea / #0f5a46, amber #fdebc8 / #7a3f00, red #fbdada / #8a1c1c, gray #e6ebf3 / #3b4a63
- Final-salary box: bg #14233f, label #cfe3ff, number #ffffff
- No white text on light backgrounds. White text only on #1f7a63 or #14233f.

## Shape and spacing
- Radius: card 18, option card 14, KPI 16, input/button 12, icon button 10, chip 99.
- Touch targets >= 44px (inputs 44, buttons 46, icon buttons 44x44).
- Card padding 22. Gaps 12-22. Page padding 28x40.

## Structure patterns
- Header row (title + pickers + action), KPI strip (4 tiles), main column (tabs + table + rule cards) and a sticky summary column (width 390).
- Status is always chip with text, never color only.
- Edit actions are icon buttons with aria-label and tooltip. "Edited" shows a gray chip.
- RTL default; use logical properties. Numbers: Western digits.

## Verify
Colors were chosen for readable contrast but not measured. Run a WCAG AA check (4.5:1 text) on every pair above before shipping.
