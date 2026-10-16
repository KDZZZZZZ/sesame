# Sesame explicit capability authoring contract

Status: approved design constraints for the development-only host API replacement. Runtime migration is tracked in the host repository's `docs/plans/2026-10-15-host-capabilities-v2.md`.

## Declaration is the public contract

Every plugin must explicitly declare its offered capabilities and how to use them. This includes callable functions and Agents, data sources, views, configured services consumed by the host, configuration, lifecycle behavior and knowledge resources. No hidden entrypoint or guessed API is part of the supported contract.

Agent-facing and host-facing consumers are declared separately on the same contribution. An Agent can select/configure a host contribution; after binding, the host consumes the declared interface directly. Packages which contain only knowledge declare the resources and no callable capabilities; their content does not need to be rewritten for this migration.

Knowledge entries explicitly identify `kind: reference | prompt | skill`. Only a declared prompt is injected as instructions and only a declared skill is registered as a skill; filenames alone do not expand the Agent's instructions or callable surface.

Each executable capability documents its purpose, required inputs/configuration, output meaning, effects and limits. Its input and output schemas describe the actual callable implementation. Examples must match that schema. Documentation references should identify the official source and applicable version when a provider's own API documentation is the clearest explanation.

## Reduce avoidable Agent work

Prioritize capabilities that currently require long preparation/check/execute/readback sequences. Put deterministic prerequisite checks, source binding, pagination, compilation diagnostics, result gathering and straightforward recovery inside implementation entrypoints. Preserve explicit user decisions and externally meaningful side-effect boundaries.

An unavailable prerequisite should return one structured diagnosis listing all known missing items and concrete supported remediation. Do not make the Agent discover a new constraint on every retry. Defaults should cover ordinary safe use; ask for extra inputs only when they change the result or authority materially.

Agent instructions state the available capabilities, clear measurable objectives/output criteria, and useful principles with causal explanations. They should help choose methods rather than prescribe one rigid sequence for every task. Capability composition is allowed; undocumented behavior is not a dependency.

## Ownership

- Plugins own domain methods, data collection/normalization, engine or broker integration, and the implementation of their declared operations.
- The host owns invocation identity, execution lifecycle, workspace-wide Run observability, resource ownership, shared contracts, state consistency, configured consumers and rendering isolation.
- Product identity and user-facing communication behavior belong to the host system prompt. Do not duplicate general user-reporting, encouragement or identity rules in plugin policy.

## Migration policy

No historical host API compatibility is required. Migrate executable/host-consumed contributions against the implemented host contract, preserving current working-tree business changes and third-party provenance. Regenerate development locks only after package behavior and declared surfaces agree. Do not treat static package validation as evidence that a native environment, model invocation, broker connection or trade succeeded.
