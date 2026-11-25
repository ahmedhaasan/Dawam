# Dawam design tokens

The canonical visual reference is `new payroll and design /DESIGN_TOKENS.md`. Implementation uses one shared theme and the following approved values.

- Local Cairo font: weights 500, 700, 800. Base 17px/500; table body 16px; table header and labels 14px/700; h1 36px/800; h2 22px/800; h3 19px/800; buttons 17px/700; final salary 44px/800. User-visible text is never below 14px.
- Surfaces: page `#f1f4f9`, card `#ffffff`, text `#14233f`, muted `#3b4a63`, border `#d5dce8`, strong border `#b7c2d4`.
- Brand: primary `#1f7a63`, primary dark `#0f5a46`, soft primary `#e3f1ed`. White text is only used on primary or dark surfaces.
- Status: success `#dff3ea/#0f5a46`, warning `#fdebc8/#7a3f00`, danger `#fbdada/#8a1c1c`, neutral `#e6ebf3/#3b4a63`.
- Radius: controls 12px, cards 18px, pills 999px. Interactive targets are at least 42px high.
- Payroll wide layout: flexible main content plus a 390px sticky summary. Narrow screens stack summary below content.
- RTL is default and all layout uses logical properties. Western digits remain the current default.

Text/background pairs must meet WCAG AA. Components must consume shared CSS variables rather than hard-coded component colours.
