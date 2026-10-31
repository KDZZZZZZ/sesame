# R3 continued plugin QA

Continue the user's authorized real-model QA on the current demo account, installed latest plugins and existing workspace. Root performs testing, observations and bug fixes; Sesame Agent performs plugin business tasks. Exclude Kurumi, pure skills/knowledge and ABU. Do not resume or modify any of the 14 pre-existing paused Runs. Keep per-failure corrections bounded; do not repeatedly retry unchanged blockers.

1. Capture current idle runtime, plugin/model identity and protected hashes without opening child databases.
2. Submit a bounded live demo trading scenario through the normal main chat. Verify market open/protection update/close and pending order create/update/cancel against actual tickets and history. Check portfolio executor and already-supported strategy execution only when prerequisites genuinely hold. Preserve non-QA objects and clean every new QA object.
3. Audit the independent factor input and quote time defects using frozen evidence and current contracts. Make a small fix only if a specific defect and regression can be demonstrated; no new architecture or invented time offsets.
4. Inspect real UI/report results and remaining independent user-facing capability gaps. Use existing fixed evidence where possible. Record pass/fail/blocked/not-tested separately, and assess design effects rather than counting calls as passes.
5. Verify final QA cleanup, retained histories/reports/model and paused tasks; commit isolated fixes locally. Do not claim all plugins passed from partial evidence.
