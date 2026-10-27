# Compact decision tree implementation
- Preserve fixed tree data, field mapping, selection callbacks and report identity.
- Replace adaptive card/vertical layout with compact horizontal SVG and bounded zoom/pan viewport.
- Regression-check full text, topology, selection, zoom/pan/reset, resize/cleanup, print and template embedding.
- Hot-update reports plugin only after idle, then ask the real Sesame Agent to update the same report from the new built-in renderer.
- Verify published report and PDF/PNG; preserve model, tasks and original bindings.
