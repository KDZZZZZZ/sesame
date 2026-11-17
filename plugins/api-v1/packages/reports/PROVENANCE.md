# Sesame report components

Reports 6 owns controlled visual components, a deterministic document renderer and
delivery through the host-selected sesame.report/1 provider. Research methods and
business report structures are separate. The component catalogue, table controls,
chart families and the blue/gray visual adapter are original Sesame MIT code.
Published HTML and fixed references remain immutable; browser controls select
supplied records and never query or compute research results.

## Third-party runtimes

- KaTeX 0.16.47 is the unchanged browser distribution from https://github.com/KaTeX/KaTeX .
  MIT license and copyright notice are retained in assets/vendor/katex/LICENSE.
  Sesame's report-math.js renders supplied LaTeX as MathML without network access.
- TradingView Lightweight Charts 5.2.1 is the unchanged standalone distribution
  from https://github.com/tradingview/lightweight-charts . It is Apache-2.0, not
  MIT. Its copyright header and assets/vendor/lightweight-charts-LICENSE remain.
  scripts/sync-market-chart.mjs checks byte equality with the host dependency.
- The generic dependency diagram uses the application's svl-graph-canvas.tsx,
  its CSS and svl-layout.js, bundled by scripts/sync-svl-view.mjs. Source digests
  are recorded in assets/svl-graph.sources.json. React, React DOM and Lucide use
  the host's installed versions; their notices remain in svl-graph.LICENSE.txt.
  This is Sesame's existing Netron-style canvas, not a bundled Netron copy.

## Visual references

The compact decision-tree layout and pan/zoom are independently written Sesame
code. AntV G6 and React Flow were visual references; no code or assets from those
libraries are bundled. The graph canvas preserves shared source geometry and
interaction, without interpreting strategy or factor expressions.

Research examined Lieflat Charts commit eace082a317b696c5570c25826a53a7fa113e984.
Its license is PolyForm Noncommercial 1.0.0, not MIT. No Lieflat template,
JavaScript, color-token file, font, screenshot or asset is redistributed.
Standard chart encodings, restraint and data-shape-based selection informed
Sesame's independent implementation. All packaged numerical fixtures are
fictional demos, not market observations or performance claims.
