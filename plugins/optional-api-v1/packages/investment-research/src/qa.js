import { digest } from '@sesame/plugin-sdk/protocol';
import { check, configuredModel, verifySelection } from './composition.js';
import { readRows, uniqueRefs } from './artifacts.js';
import { memberInput, waitForMember, waitForRun } from './members.js';
import { ANALYSTS, ASK_ID, REVIEWERS, TITLES, qaInstructions } from './team.js';

export const uniqueQuestions = questions => [...new Map(questions.map(value => [value.qa_run_ref.id, value])).values()];

export async function questionAnswers(host, requester, { signal, wait = false, exclude } = {}) {
  const runs = []; let cursor;
  do {
    const page = await host.runs.list({ parentRunId: requester.id, capabilityId: `sesame/investment-research#${ASK_ID}`, limit: 200, ...(cursor ? { cursor } : {}) });
    runs.push(...page.items.filter(run => run.id !== exclude));
    check(!page.nextCursor || page.nextCursor !== cursor, 'INVALID_RUN_HISTORY', 'Question history pagination did not advance.');
    cursor = page.nextCursor;
  } while (cursor);
  runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const answers = [];
  for (const value of runs) {
    // Concurrent questions must not wait for each other. The parent joins every
    // accepted question before handing research to the next role.
    const run = wait ? await waitForRun(host, { id: value.id }, signal) : value;
    if (run.status === 'completed') answers.push({ ...run.output, qa_run_ref: { id: run.id } });
  }
  return answers;
}

export async function researchQuestion(host, input, signal, execution) {
  check(execution?.run?.id && typeof execution.checkpoint === 'function', 'QA_CONTEXT_REQUIRED', 'Research questions run inside the investment research team.');
  const state = structuredClone(execution.checkpointState ?? { inputDigest: digest(input) });
  check(state.inputDigest === digest(input), 'CHECKPOINT_MISMATCH', 'Resume this question with its original input.');
  const save = () => execution.checkpoint(structuredClone(state));
  try {
    if (!state.request) {
      const agent = execution.provenance?.agent, original = agent?.input, context = original?.qa_context;
      check(REVIEWERS.includes(original?.role) && context?.workflow_ref?.id && agent.runId === execution.provenance.parentRunId,
        'QA_CONTEXT_REQUIRED', 'Only downstream reviewers inside investment_research_analyze can ask its original analysts.');
      check(ANALYSTS.includes(input.analyst), 'INVALID_ANALYST', 'Choose market, fundamentals, news or sentiment.');
      const { run: caller } = await host.runs.read({ id: agent.runId }), { run: workflow } = await host.runs.read(context.workflow_ref);
      check(caller.parentRunId === workflow.id && caller.task?.agentId === original.role && workflow.capabilityId === 'sesame/investment-research#investment_research_analyze',
        'QA_CONTEXT_REQUIRED', 'The question must belong to this original research team.');
      const packet = original.research ?? (await readRows(host, original.context_ref))[0];
      const qa = uniqueQuestions([...(packet.qa ?? []), ...await questionAnswers(host, { id: agent.runId }, { signal, exclude: execution.run.id })]);
      const research = { ...packet, qa, source_refs: uniqueRefs([...packet.source_refs, ...qa.flatMap(answer => answer.source_refs)]) };
      state.from = original.role; state.selection = context.selection;
      state.request = {
        title: `${packet.title.slice(0, 60)} · ${TITLES[input.analyst]}定向核查`,
        objective: '回答会影响判断的具体问题，核查证据和机制，说明对原结论的修正及剩余不确定性。',
        instructions: qaInstructions(input.analyst),
        input: await memberInput(host, research, { role: input.analyst, qa: { from: original.role, question: input.question } }, `${execution.run.id}:context`),
        model: configuredModel(host, context.models[input.analyst]), plugins: state.selection.plugins, allowedCalls: state.selection.allowedCalls,
      };
      await save();
    }
    await verifySelection(host, state.selection);
    configuredModel(host, state.request.model);
    if (!state.ref) {
      const accepted = await host.capabilities.invoke('host.agent.run', state.request, {
        signal, operationId: `${execution.run.id}:answer`,
        task: { title: `${TITLES[input.analyst]}定向核查`, agentId: input.analyst, role: input.analyst, stage: 'qa', output: { type: 'none' } },
      });
      check(accepted.type === 'run', 'INVALID_HOST_RESULT', 'A research answer must return a tracked host Run.');
      state.ref = accepted.run; await save();
    }
    state.result ??= await waitForMember(host, state.ref, input.analyst, signal);
    await save();
    const { markdown, run_ref, source_refs } = state.result;
    return { from: state.from, to: input.analyst, question: input.question, markdown, run_ref, source_refs };
  } catch (error) {
    if (signal?.aborted || error.code === 'RUN_INTERRUPTED') throw error;
    return execution.interrupt({ reason: error.message, state, requirements: [{ id: error.code ?? 'RESEARCH_QA_UNAVAILABLE', available: false, reason: error.message }] });
  }
}
