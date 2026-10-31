Refresh the plugin directory from the published R2 dev.3 catalog: 54 packages, including 10 new or updated versions, with Kurumi excluded. The preview records the exact published catalog hash and source commit `5c44877c13618905cc85b820e21a8fd51a1d3684`.

Update the compatibility regression to check all six workflow/backend packages that require Sesame `>=0.2.3-dev.8`. The website remains a descriptive directory; installation resolves through the separate R2 catalog. No application downloads, Worker behavior, or report example changes.

Validation: `npm run verify:plugins`, `npm run verify:plugin-preview`, and `npm run check` (23 passing tests). R2 publication: https://github.com/KDZZZZZZ/sesame/actions/runs/38590188259.
