## Change

Add `sesame/investment-research` 3.1.4 as an independent research workflow. Four analysts produce reusable evidence; bull, bear, risk and manager can ask the original analysts targeted follow-up questions. Answers and sources reach later roles and the final manager report.

The existing analyze entry also supports rerunning from bull, bear, risk or manager while preserving the completed prefix and original artifacts. Report-only rewriting remains limited to the supplied research packet. Prompts require a clear thesis and evidence-based reasoning, with meaningful unresolved gaps checked through analyst QA when applicable.

## Validation

- Research suite against the local Sesame host: 24 scenarios, including actual package installation, eight-agent execution, source acquisition through risk/manager QA, interrupted QA recovery and repeated large-context suffix reruns. A source-fixture assertion was corrected to verify the returned data instead of a field absent from the dev source-plugin version; the affected scenario was rerun separately.
- Source-lock, capability binding, inventory/profile and dev CI tests: 46 scenarios, including the updated optional-package count.
- Repository validation: 9 core + 47 optional packages; source locks, inventory and existing publication plans pass.
- JavaScript syntax, Oxlint and whitespace checks pass.
- Previously exercised the identical package with configured OpenAI gpt-6.1-sol on the Nasdaq study: risk and manager each requested analyst QA; the final three-chart report passed Sesame native desktop/narrow rendering checks.

## Compatibility

Plugin API 2; Sesame >=0.2.4. Uses the public host SDK, configured model and explicitly selected research capabilities. Reports additionally require reports, data-access, workspace and plugin-manager. No trading account is required.

This change adds only the research package, its tests, documentation and source inventory/lock entries. It does not publish a release, promote the install catalog, change the host or update other plugin packages.
