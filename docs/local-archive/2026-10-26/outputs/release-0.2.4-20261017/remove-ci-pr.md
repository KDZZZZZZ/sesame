Pull requests currently rerun the trusted base validator's unit tests in two required jobs. A stale assertion in that base prevents even a PR that fixes it from merging.

Remove those duplicate self-test steps from the PR workflows. The checks still validate candidate package locks, capability declarations, source identities and release plans using the read-only trusted validator. Run the complete validator regression set on the actual main revision in the plugin publisher before any upload. Update the workflow contract tests and publication documentation to match.

Validation: the complete 137-test publication regression set, including malformed packages, immutable uploads, exact-head review, updater assets and plugin catalog behavior. No branch-protection or semantic-review requirement is removed by this change.
