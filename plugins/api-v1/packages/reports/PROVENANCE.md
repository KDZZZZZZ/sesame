# Sesame report components

## Host-selected presentation provider (5.0.0)

The host selects the report service under `sesame.report/1`. Its describe operation
returns the selected plugin's input schema. This package defines its own generic
components and returns packaged files through the host-only `report_render`
operation; only the host publishes new report artifacts. `report_publish` is a
convenience facade to that same host operation, not a second publication route.
Complete UTF-8 JSON input can be registered once and passed by fixed `inputRef`,
so formulas and large result records need not be copied into a second request.

There is one default blue/gray frameless layout. Authors choose components and
columns/stack relationships; public style presets are removed. Explicit user
style tokens and exact saved user versions remain supported. Already published
HTML is not regenerated. Historical saved user styles retain their original
dimensions when selected by their exact saved version.

Native backtests can provide actual fixed source/run evidence without inventing
SVL. Recorded winners, every parameter trial, matrix interactions and sensitivity
remain unchanged. A genuine SVL source still requires its graph digest to match
that exact source revision. Neither path runs or changes the underlying research.
This provider requires Sesame >=0.3.0-dev.2 and does not ship a new chart library.

## Structured content and reusable styles (4.0.0, historical)

Version 4 introduced `report_publish({content, style, ...})`.
Report owns HTML generation, chart runtimes, typography, the blue/gray borderless
presentation, LaTeX rendering and the end-of-report evidence appendix. Generic
`document` blocks can be composed independently of instruments, research methods
or workflow plugins. Existing modules, backtest and signal-study result adapters
use the same style service; they do not select or execute research algorithms.

The declarative content renderer, unified style and bounded user token extensions are
original Sesame code under this package's MIT license. Custom styles can be saved
and reused at an exact version. Authors cannot upload HTML, CSS, JavaScript,
render callbacks or arbitrary executable assets through this interface. Template
and compose helpers are previews, not required authoring or publication stages.
Published artifacts retain generated HTML, fixed references and original evidence;
changes to presentation do not recalculate or replace the research results.
Historical sections below describe prior versions, not alternative 5.0 authoring
interfaces.

## Bundled LaTeX rendering

`assets/vendor/katex/katex.min.js` is the unmodified browser distribution from
[KaTeX](https://github.com/KaTeX/KaTeX), version **0.16.47**, copied from the host's
installed `node_modules/katex/dist/katex.min.js`. Its license is **MIT**, retained
in `assets/vendor/katex/LICENSE`, with the upstream notice:
`Copyright (c) 2013-2020 Khan Academy and other contributors`.
The installed package metadata and original license were checked on 2026-10-29.

`assets/report-math.js` is Sesame's local adapter. Formula content is supplied as
LaTeX and rendered through the bundled KaTeX runtime as MathML; the adapter does
not fetch a CDN, remote font or external script. KaTeX's upstream license is
preserved separately from the original Sesame renderer and content/style code.

## Business coverage expansion (3.6.0)

The catalog now has 19 optional modules, 11 suggested compositions and 48 built-in
chart recipes. Calendar, strategy-performance and portfolio-construction fields
and the additional business fields are original Sesame result structures, not a
copy of a vendor API or proprietary model. Report does not choose an optimizer,
backtest rule, sentiment algorithm, factor score, stop formula or estimator.
The added fixture source computes explicitly fictional monthly paths, option
settlements and display records only. Runtime tables and charts preserve those
fixed outputs and user-selected fields; no new library or data service is added.

## Adjustable business fields (3.4.0)

The 16 module definitions, eight suggested compositions, structure resolver and
fixed-result composer are independently authored Sesame code under this package's
MIT license. Public Trading Central product categories informed the research
organization (Technical Insight, Economic Insight and Panoramic View); no TC
template, prose, dataset, proprietary algorithm or visual asset is included.
Templates select output fields only. User-selected methods retain their own
identity, theory, evidence and validation; the composer does not implement market
analysis, historical matching or probability calibration. The bundled module
example is explicitly fictional and is not a verified market prediction.

reportKit, the report stylesheet, Sesame Charts 1.1.0, the scaffolds and the
integration tools in this directory are Sesame code, distributed under the local
MIT license. The reportKit visual layout and writing/design guidance are restored
from Sesame's original pre-refactor reports (0.1.4), rather than replacing that
layout with an unrelated gallery style. The borderless typography, conclusion,
metric rules, numbered evidence sections, legends, hover inspection and folded
methods retain the original design. The earlier read-only data bridge, resource
lifecycle and optional interaction extensions were adapted for API 1; current
publication uses the structured API described above. Components
and style fallbacks are packaged here, with no imports from the private host.
They require no CDN or external font. The optional candlestick component reuses
the workbench's packaged Lightweight Charts runtime as described below. The immutable
report artifact retains generated HTML, local assets and fixed DataRef inputs.

Design research examined [Lieflat Charts](https://github.com/larashero3-dotcom/lieflat-charts)
at commit `eace082a317b696c5570c25826a53a7fa113e984` on 2026-10-09 and rechecked on 2026-10-10, including its
license, third-party notices, SVG gallery, report-09 dashboard and report catalog.
Its current license is **PolyForm Noncommercial 1.0.0**, not MIT. No Lieflat
template, JavaScript, color-token file, font, screenshot or other asset is
redistributed or relabeled here. Its noncommercial terms are not converted into
an open-source grant by attribution.

General ideas informing this independently written implementation are data units
that remain visible, restrained color, readable source notes, separate fast
overview and row inspection, and chart selection by data shape. Concrete new
implementations include zero-centered signed bars, gap-preserving time series,
keyboard-selectable marks linked to a row table, explicit missing matrix cells,
and labelled unit charts that reject fractional or excessive unit counts. The optional component
API and SVG routines were independently authored for Sesame's fixed-data bridge.
They supplement, rather than replace, the original reportKit layout and skills.
No upstream requirement to copy templates or impose a chart count is adopted.

The example dataset is explicitly **demo** throughout. It is not market history,
portfolio performance, a survey or a native backtest. Financial calculations and
precision-sensitive statistics belong in registered computation results; SVG
coordinates use JavaScript numbers while source tables retain exact strings.

Future use of upstream code must retain its actual terms and required notices,
or obtain a suitable additional license. Merely being publicly readable or free
of charge does not make that upstream code permissively licensed.

The optional independently authored collection now also includes waterfall, paired comparisons, strip plots, supplied-bin histograms, supplied-statistic boxes, supplied-grid ridgelines/violins, calendars, parallel coordinates, rank trajectories, lifecycle events, exposure treemaps, identified record threads, conserved flows and circular/stable-force network layouts. The statistics, temporal and structural modules contain no copied upstream code. All gallery input is explicitly fictional; financial estimates are not calculated inside these renderers. Selection and filtering preserve the identity of fixed source rows.

## Compact decision trees

The selected compact decision-tree style uses slim decision marks, leaf dots,
curved branches, edge conditions and a blue selected path. Design research
considered [AntV G6](https://github.com/antvis/G6) and
[React Flow](https://github.com/xyflow/xyflow); the SVG layout and pan/zoom
interaction are independently authored Sesame code. No upstream library,
template, screenshot or other asset is bundled for this component. It uses the
existing report palette and source-row selection contract, with no added
dependency or host interface.

## Default market candles

`assets/vendor/lightweight-charts.js` is the unmodified standalone production
distribution of [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts),
currently 5.2.1, copied from the host's already installed dependency using
`scripts/sync-market-chart.mjs --host <host-root>`. It is Apache-2.0, not MIT;
its original copyright header and `lightweight-charts-LICENSE` are retained.
The chart hides its duplicate logo; attribution remains in Sesame settings.
`--check` verifies exact byte equality with the workbench dependency. No runtime
host import, CDN, package installation or network request is required.
`assets/charts-market.js` is Sesame's MIT adapter for fixed OHLC rows, shared
theme tokens, source-row selection and lifecycle cleanup. Candle bodies, wicks,
axes, crosshair and interaction are rendered by the existing library.

## Module visual fields and historical confidence (3.5.0)

The 33 optional chart recipes independently map module questions to existing reportKit/SesameCharts renderers, including the packaged market candlestick renderer. No additional chart library or proprietary TC content was copied. Confidence and inference fields bind comparable historical scenarios, realized outcomes, sample accounting and method evidence; rendering does not estimate or certify predictions. The deterministic fixture generator uses fictional cases and explicitly chosen demo estimators only.

## Field guidance and visual composition (3.6.0)

The expanded catalog contains 19 modules, 11 suggested compositions and 55 optional chart fields. Per-field semantics and visual reading plans are independently authored, optional guidance; they do not choose a research theory. Frameless metric/score/range projections preserve supplied values, scale guards and full source details. The layout direction follows the user's reference and preferences; the Carbon bullet-chart documentation is cited as a design reference, with no imported code or assets.

The market adapter can display already computed price-column overlays through the existing Lightweight Charts runtime. Same-candle multi-method examples are deterministic fictional fixture calculations, separate from report composition; new FVG/ATR observations do not borrow confidence from unrelated historical cases. Knowledge-versus-history comparisons render the supplied explanation without calculating support. Original native backtest logic, matrix inspection and parameter explorer are retained.

The result-origin semantics cover every suggested field for Agent use only. Acquisition and method capability audits remain separate development evidence, not report dependencies or required algorithms. The independently authored reasoning layout presents supplied observations, explanation, historical counts and judgment without provenance-type badges. Design references include the FT Visual Vocabulary, Observable Plot, Vega-Lite and ONS uncertainty guidance; no code or assets from these sources are bundled. Count bars only project supplied mutually exclusive counts over their given denominator; they do not estimate predictive confidence.


## 3.6.2 呈现变更

证据展开区统一集中末尾附录；移动原 DOM 节点以保留精确值、固定引用与既有回调。主图、判断、推理与关键条件保留正文。自定义证据明确标记，交互控制和用户 inline 布局不迁移。本变更不执行分析，不更改任何研究或置信度计算。

## Shared application SVL canvas (5.0.17)

Report logic uses the application's `svl-graph-canvas.tsx`, its CSS, and
`svl-layout.js`, bundled by `scripts/sync-svl-view.mjs --host <host-root>`.
The application and reports use the same node drawing, ports, routing, selection,
zoom, and pan code. The former report-only SVG renderer is removed. Report code
only supplies recorded graphs, display labels, theme variables, and evidence links.
`--check` rebuilds offline and rejects byte drift; `assets/svl-graph.sources.json`
records the shared source digests. React, React DOM and Lucide are bundled from
the host's installed dependencies with their notices in `svl-graph.LICENSE.txt`.
This is Sesame's existing Netron-style view, not a bundled copy of Netron.

## Source-driven execution and expression views (5.0.18)

The application and report bundle also share `svl-logic-model.js`,
`svl-logic-view.tsx`, `svl-expression-model.js`, `svl-expression-tree.tsx`
and their styles. The logic view preserves source event/step/branch ordering;
the calculation tree expands source primitives, operands, variables, parameters
and function definitions lazily. Neither view executes or changes a strategy.
Source defaults and initial state are explicitly distinguished from runtime values.

Design references were [Unreal Blueprint nodes](https://dev.epicgames.com/documentation/unreal-engine/nodes-in-unreal-engine)
for separating execution from data flow and [Stateflow charts](https://www.mathworks.com/help/stateflow/gs/get-started-create-chart.html)
for event/condition/action structure. No code or visual assets from those products
are included; these are independently authored Sesame components.

## SVL source comments (5.0.19)

The same shared renderers now prefer validated `source.comments` labels and short
descriptions, retaining source operator/variable identities and operand ordering.
Comments are displayed as plain text; they never supply executable expressions,
change the graph, or create unimplemented strategy rules. Commented source has
its own identity and must not replace the original reference in execution evidence.
## Composition and comparison collection (5.0.20)

Eight independently authored SVG renderers add centered composition streams,
stacked and paired unit ticks, dot heatmaps, decreasing-count funnels,
item-to-category links, historical outcome tallies and animated rankings.
Lieflat candidates F16/F7/F10/L13/L12/L15/F6/G16 informed the selected visual
families. No Lieflat implementation or assets are included: its source uses
PolyForm Noncommercial 1.0.0. The new Sesame module is original MIT code using
the existing chart registry, theme and export path. No chart runtime is added.
Ranking playback is user-initiated; exports start at the specified fixed frame
(latest by default). All fixtures are fictional demos.

## Remaining selected visual families (5.0.21)

Four original SVG renderers complete the user-selected A–H collection: bounded
multi-dimension position rails, exact-unit tick donuts, dense observation stems,
and annual bubble ledgers. As in 5.0.20, these independently implement standard
visual encodings without copying upstream source or assets. They use fixed
report observations, retain source-row identity and share the report theme.
Missing observations remain distinct from zero; circle area represents magnitude.
