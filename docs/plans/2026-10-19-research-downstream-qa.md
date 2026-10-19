# Downstream analyst QA and suffix reruns

The four original analysts remain available to bull, bear, risk and manager through the same scoped `investment_research_ask` capability. Each answer retains its sources, original analyst identity and resumable Run. Later roles receive completed answers; the final packet includes manager questions as well. Report-only rewriting stays limited to the supplied frozen packet.

Add `start_from: {result_ref, role}` to the existing analyze entry. It inherits the original question, subjects and evidence time, retains only members and QA before that role, and runs the remaining roles in a new native workflow. Source selection and model are explicit for the new work. The original packet and report remain immutable. Reused results and the starting point are recorded in the new packet.

Verification: reproduce missing risk/manager access in the real-host SSE fixture; cover prefix preservation, exclusion of later QA, interruption/resume and report-only grants; then run unit, real-host and lint checks. Finally use configured OpenAI gpt-6.1-sol to rerun risk and manager from the original Nasdaq study, let them select their own QA, and capture the resulting report through Sesame's native renderer.
