# Single-source unavailability

Keep ordinary URL failures inside the web-sources result contract so a researcher can skip or replace one source without interrupting its Agent, siblings or parent workflow.

1. Lock the expected behavior with fetch and actual-host regressions: HTTP 404 returns an explicit unavailable result, the same Agent reads it and fetches another URL, and the parent and sibling finish without interrupts. Preserve successful raw bytes and provenance.
2. Convert only recognized HTTP, transport, decoding, size and source-format failures into unavailable results. Keep cancellation, invalid caller input, programming errors and artifact-storage failures as exceptions.
3. Give both capabilities discriminated output schemas and exact usage documentation. A failed sources_fetch has no ref or provenance; an unavailable http_query page has empty items only as a required row-envelope field and explicit unavailable metadata, never an observed empty dataset.
4. Run the targeted fetch, parser and actual-host tests plus syntax/lint checks. Do not change the host Run lifecycle, other plugins, or the official lock in this lane.
