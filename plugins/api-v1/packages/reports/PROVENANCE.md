# Sesame report components

reportKit, the report stylesheet, Sesame Charts 1.0.2, the scaffolds and the
integration tools in this directory are Sesame code, distributed under the local
MIT license. The reportKit visual layout and writing/design guidance are restored
from Sesame's original pre-refactor reports (0.1.4), rather than replacing that
layout with an unrelated gallery style. The borderless typography, conclusion,
metric rules, numbered evidence sections, legends, hover inspection and folded
methods retain the original design. Only the read-only data bridge, resource
lifecycle and optional interaction extensions are adapted for API 1. Components
and style fallbacks are packaged here, with no imports from the private host.
They require no CDN, external font or third-party chart runtime. The immutable
report artifact retains the authored HTML, local assets and fixed DataRef inputs.

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
