# Register an authored translation from one file

For long source, write the native code and source map in the current task workspace, then assemble one UTF-8 JSON manifest with a local script. Call `mt5_translation_file` with only `operation_id` and `manifest_path`. The manifest has exactly the `mt5_translation` fields **except** `operation_id`: `title`, full `source` and `target` ArtifactRefs, `mode`, `parameter_map`, `files`, `source_map`, and `adaptations`. All are required. `files` maps native relative project paths to source text; this tool does not scan directories or follow file references inside JSON.

Read the exact tool schema from the packaged `tools.json`. Use the existing fixed source and target refs and actual source-node IDs. Do not ask the model to repeat a long generated program in another tool argument. For example, after writing `translation-metadata.json` with the refs, mappings and other fields, run this in the actual workspace cwd:

```python
import json
from pathlib import Path

manifest = json.loads(Path("translation-metadata.json").read_text(encoding="utf-8"))
manifest["files"] = {
    "Experts/Strategy.mq5": Path("native/Strategy.mq5").read_text(encoding="utf-8"),
    # List each additional Include/Strategy/*.mqh file explicitly, if needed.
}
assert "operation_id" not in manifest
Path("translation.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
```

Then call:

```json
{"operation_id":"translation_unique_operation_01","manifest_path":"translation.json"}
```

Use a fresh stable operation ID for each new translation. The path may be relative to the current workspace or an absolute path inside it. Parent traversal, outside paths, symbolic links (including parent directories), directories and special files are rejected. This restriction applies to this file intake tool, not to the Agent's general host-file permissions. Only that one manifest is read.

The raw JSON file and normalized manifest are each limited to 8 MiB. Existing native-project limits also apply: each source is at most 1 MiB UTF-8, the complete generated project at most 4 MiB and 128 files including the generated rules file, and source-map/adaptation arrays at most 1,000 entries. SDK headers and generated rules cannot be replaced. Both registration tools use the same strict schema and source/target/mapping/parameter/project validation. Unknown fields and invalid UTF-8/JSON are errors; neither entry point coerces schema types. Input strings retain their exact content; only the stored project's display title has surrounding whitespace removed.

Before publication, the normalized input is fixed in plugin storage. Once a snapshot exists, the same operation ID and normalized path **reuse those bytes without rereading the file**. This includes retries after a timeout, workspace cleanup or file deletion; `manifest.reused` and the fixed digest make that reuse explicit. Editing the old file does not change the operation. Use a new operation ID to register new content. A different path under the old ID is a conflict; concurrent initial reads with different content also conflict. If semantic validation fails after the input was fixed, correct the manifest and use a new ID.

The returned `manifest.digest` hashes the canonical normalized JSON. `manifest.source.sha256` hashes the original file bytes; whitespace differences can change that file hash without changing the normalized-input hash. The compact result also contains the project/revision and immutable source, translation and validation refs; it does not repeat source text or maps. The project and a recovery receipt commit together. A lost response after that commit can be recovered without creating another project or resetting an already edited project.

Registration does not compile, run the Tester, prepare or mount a terminal, or place orders. Its validation result remains `partial`; source maps and type checks do not prove native semantic equivalence. Continue with explicit compilation and the separately authorized native workflow only after registration succeeds.
