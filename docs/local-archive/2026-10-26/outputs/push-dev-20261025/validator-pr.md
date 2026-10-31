The trusted dev validators currently reject the next plugin candidate before it can be reviewed: its narrowed host range includes an exclusive upper bound, and its descriptive inventory uses the new functional taxonomy. Prepare the trusted validators first so the main plugin update can pass the existing pull_request_target checks without executing candidate code or changing branch protection.

- Accept a SemVer lower bound with an optional exclusive upper bound only when the entire range fits the profile; reject widened, malformed or alternative ranges.
- Validate either the complete existing four-field policy or the complete taxonomy policy. Reject mixed or partial formats, unknown fields and attempts to override package facts. Derive implementation kinds and permissions from the package declarations for the newer projection.
- Preserve the exact existing inventory projection for the currently published data. Plugin packages, profiles, inventories, locks, publication plans and CI workflow files are unchanged.

Validation: 57 targeted tests passed. Independently checked old trusted validators against this branch's unchanged package data; new validators against that same old data; and new validators against plugin PR #92 at f2ffac9. All three combinations passed both package locks and complete catalog validation, including both immutable R2 plans and the 12 application-release assets. The last combination includes 10 core and 48 optional packages.

This is a prerequisite for #92. Candidate plugin and validator files remain data only in the existing CI trust model.
