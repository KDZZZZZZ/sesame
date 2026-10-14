# Factor evaluation tool protocol v1

A workflow explicitly selects `{plugin_id, tool, arguments?}`. Neither tool name nor plugin ID is prescribed by the protocol. The implementation must be a trusted installed plugin with a delegatable tool. Its version/digest is frozen for the run. The workflow calls it only inside a live main/role tool invocation; service callbacks do not call tools.

Every request contains `protocol: "sesame.factor-evaluator/v1"`, `action`, `run_id`. Every successful receipt returns `protocol`, `action`, `runId`, `sessionId` and `receiptDigest`. The digest is SHA-256 of canonical sorted-key JSON of the complete receipt excluding receiptDigest. It detects mismatched/corrupt records; authenticity comes from calling the selected installed implementation, not a model-provided digest.

| Action | Additional request | Required receipt |
| --- | --- | --- |
| prepare | optional dataset_id; options = selected arguments; access = restricted or development-only | inputDigest; data with digest and holdoutMode (workflow-isolated or none); development.rows containing only public development observations; contract.instructions (<=6000 characters), optional candidateExample and dataset/metricColumns metadata |
| candidate | session_id, trial_id, opaque candidate object, accepted_ids | trialId, normalized candidate, candidateDigest, metrics object, eligible boolean, gate text, redundancy array |
| select | session_id, trial_ids | exact trialIds and selectionDigest; freezes the set without returning holdout results |
| finalize | session_id, selection_digest | matching selectionDigest, holdout object, holdoutStatus = evaluated or not-requested, archive.rows plus implementation-specific reproducibility metadata |

Prepare runs under the main workflow tool. Candidate/select run within its structured submit tool. Finalize runs in a separate real task after selection is saved. Every task uses output:none. The finalizer returns a bounded receipt to the Agent; archival inputs remain in durable workflow/evaluator storage. Only the final summary creates report files.

Candidate/session/selection retries are idempotent and immutable. A different candidate under the same trial ID or a changed frozen selection must fail. Failed/incompatible receipts never become metrics. Evaluator implementations own normalization, numerical method, eligibility, redundancy, input immutability and reproducibility; the workflow never computes AST or Rank IC.

A semantic rejection before committing a candidate/selection uses error code EVALUATION_REJECTED, permitting the assigned Agent to correct its proposal. An interrupted or unknown outcome retains the original pending input for an idempotent retry. Prepare/finalize receipts are bounded to 5MiB; candidate/select receipts to 64KiB.

The bundled implementation requires nested invocation and binds the session to its calling plugin and owning conversation. Subagent calls additionally require a running task from that workflow for the same run. Direct Agent calls, other workflows and other main conversations cannot operate that session. Installed native plugins are trusted code; this is a workflow access boundary, not isolation from malicious native code or external processes.

General research capabilities use development-only access: an evaluator must not ingest or later claim a holdout in that session. The bundled implementation rejects observations after validationEnd. A truly external immutable holdout service may define a future protocol extension; the current workflow does not imply such a guarantee for globally registered datasets.
