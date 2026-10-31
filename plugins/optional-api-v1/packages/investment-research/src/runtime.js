import { digest } from '@sesame/plugin-sdk/protocol';
import { check, configuredModel, reportSelection, selectResearch, synthesisSelection, verifySelection, stageSelection } from './composition.js';
import { PACKET_TYPE, checkedReport, publishPacket, readPacket, uniqueRefs, verifyRefs } from './artifacts.js';
import { ASK_CALL, REVIEWERS, ROLES, roleInstructions } from './team.js';
import { memberInput, waitForMember } from './members.js';
import { questionAnswers, uniqueQuestions } from './qa.js';
import { researchPlan, publicPlan, workflowCollaboration, questionMembers } from './workflow.js';

const packetOf = state => ({
  schemaVersion: '1.0.0', type: PACKET_TYPE, status: 'complete', title: state.input.title, question: state.input.question,
  subjects: state.input.subjects, as_of: state.input.as_of ?? state.createdAt,
  ...(state.input.horizon ? { horizon: state.input.horizon } : {}),
  evidence_refs: state.input.evidence_refs ?? [],
  ...(state.input.report_brief ? { report_brief: state.input.report_brief } : {}),
  ...(state.plan?.custom ? { workflow: publicPlan(state.plan) } : {}),
  members: (state.plan?.stages.flat() ?? ROLES).filter(role => state.members[role]).map(role => state.members[role]),
  qa: state.qa ?? [],
  summary: state.members[state.plan?.synthesis ?? 'manager']?.markdown ?? '',
  source_refs: uniqueRefs([...(state.input.evidence_refs ?? []), ...Object.values(state.members).flatMap(member => member.source_refs), ...(state.qa ?? []).flatMap(answer => answer.source_refs)]),
});

export async function researchWorkflow(host, input, signal, execution, mode) {
  check(execution?.run?.id && typeof execution.checkpoint === 'function', 'WORKFLOW_CONTEXT_REQUIRED', 'Invoke this declared workflow through the host capability interface.');
  const wantsReport = execution.task?.output?.type === 'report';
  check(mode !== 'report' || wantsReport, 'REPORT_OUTPUT_REQUIRED', 'Report regeneration requires task.output:{type:"report",space:"research",path:"...html"}.');
  const state = structuredClone(execution.checkpointState ?? {
    schemaVersion: '1.0.0', mode, input, inputDigest: digest(input), createdAt: new Date().toISOString(), jobs: {}, members: {},
  });
  check(state.mode === mode && state.inputDigest === digest(input), 'CHECKPOINT_MISMATCH', 'Resume this research with its original frozen input.');
  let saving = Promise.resolve();
  const save = () => {
    const snapshot = structuredClone(state);
    saving = saving.then(() => execution.checkpoint(snapshot));
    saving.catch(() => {}); return saving;
  };
  try {
    if (mode === 'report') {
      state.packet ??= await readPacket(host, input.result_ref);
      state.plan ??= researchPlan(state.packet.workflow);
      await verifyRefs(host, state.packet.source_refs);
    } else {
      if (input.start_from && !state.prefixLoaded) {
        const previous = await readPacket(host, input.start_from.result_ref);
        const previousPlan = researchPlan(previous.workflow);
        state.plan ??= input.workflow ? researchPlan(input.workflow) : previousPlan;
        const ordered = state.plan.stages.flat(), restart = ordered.indexOf(input.start_from.role);
        check(restart >= 0 && (state.plan.custom || REVIEWERS.includes(input.start_from.role)), 'INVALID_RESTART_ROLE', 'Restart at a declared downstream member.');
        const prefix = ordered.slice(0, restart);
        const predecessors = (plan, id) => plan.stages.slice(0, plan.stages.findIndex(stage => stage.includes(id))).flat();
        check(prefix.every((id, index) => previousPlan.stages.flat()[index] === id && digest(previousPlan.members[id]) === digest(state.plan.members[id]) && digest(predecessors(previousPlan,id)) === digest(predecessors(state.plan,id))), 'INVALID_RESTART_PREFIX', 'Changed upstream members or dependencies require a new research run.');
        check(prefix.every(role => previous.members.filter(member => member.role === role).length === 1), 'INVALID_RESEARCH_RESULT', 'The original result must contain each retained member exactly once.');
        const acquired = new Set([...previous.members, ...(previous.qa ?? [])].flatMap(item => item.source_refs ?? []).map(ref => digest(ref)));
        const { horizon: _requestedHorizon, ...restartInput } = input;
        state.input = { ...restartInput, title: previous.title, question: previous.question, subjects: previous.subjects, as_of: previous.as_of, ...(previous.horizon === undefined ? {} : { horizon: previous.horizon }),
          evidence_refs: previous.evidence_refs ?? previous.source_refs.filter(ref => !acquired.has(digest(ref))),
          ...(previous.report_brief ? { report_brief: previous.report_brief } : {}) };
        state.members = Object.fromEntries(previous.members.filter(member => prefix.includes(member.role)).map(member => [member.role, member]));
        state.qa = (previous.qa ?? []).filter(answer => prefix.includes(answer.from));
        state.prefixLoaded = true;
        await save();
      }
      state.plan ??= researchPlan(input.workflow);
      input = state.input;
      await verifyRefs(host, packetOf(state).source_refs);
    }
    const plan = state.plan, synthesis = plan.synthesis;
    state.planDigest ??= digest(plan);
    check(state.planDigest === digest(plan), 'FROZEN_WORKFLOW_CHANGED', 'Restore the frozen research plan before resuming this Run.');
    check(Object.keys(input.agent_models ?? {}).every(id => Object.hasOwn(plan.members,id)), 'INVALID_WORKFLOW', 'agent_models must name members of the actual research plan.');
    const stages = mode === 'report' ? [[synthesis]] : plan.stages;
    const collaboration = mode === 'analyze' ? workflowCollaboration(plan) : null;
    if (mode === 'analyze' && plan.custom) {
      check(typeof execution.setCollaboration === 'function', 'HOST_WORKFLOW_PLAN_UNAVAILABLE', 'This custom research plan requires a host with execution.setCollaboration; update the host and resume this Run.');
      await execution.setCollaboration(collaboration);
    }
    const pendingRoles = stages.flat().filter(role => !state.members[role]);
    state.models ??= Object.fromEntries(stages.flat().map(role => [role, configuredModel(host, input.agent_models?.[role] ?? input.model)]));
    const models = Object.fromEntries(pendingRoles.map(role => [role, configuredModel(host, state.jobs[role]?.request?.model ?? state.models[role])]));
    if (mode === 'analyze' && pendingRoles.length) {
      state.research ??= await selectResearch(host, input.research);
      await verifySelection(host, state.research);
    }
    if (pendingRoles.includes(synthesis)) {
      state.synthesis ??= wantsReport ? await reportSelection(host) : await synthesisSelection(host, state.research ?? await selectResearch(host, input.research));
      await verifySelection(host, state.synthesis);
    }
    await save();

    async function member(role) {
      if (state.members[role]) return;
      signal?.throwIfAborted();
      const member = plan.members[role], final = role === synthesis;
      const phase = state.input.workflow_profile === 'report-research/1' ? role : null;
      state.stageSelections ??= {};
      if (!final && phase) state.stageSelections[role] ??= await stageSelection(host, state.research, phase);
      const selection = final ? state.synthesis : state.stageSelections[role] ?? state.research;
      const targets = questionMembers(plan, role).filter(id => state.members[id]);
      const canAsk = mode === 'analyze' && (plan.custom ? targets.length > 0 : REVIEWERS.includes(role));
      await verifySelection(host, selection);
      let job = state.jobs[role];
      if (!job) {
        const packet = mode === 'report' ? state.packet : { ...packetOf(state), status: 'in-progress' };
        const details = { role, ...(mode === 'report' ? { result_ref: input.result_ref } : {}),
          ...(canAsk ? { qa_context: { workflow_ref: execution.run, selection: state.research,
            requester: role, members: Object.fromEntries(targets.map(id => [id, plan.members[id]])),
            ...(state.input.workflow_profile ? {memberSelections:Object.fromEntries(targets.map(id => [id,state.stageSelections[id] ?? state.research]))} : {}),
            models: Object.fromEntries(targets.map(analyst => [analyst, configuredModel(host, state.models[analyst])])) } } : {}) };
        const researchInput = await memberInput(host, packet, details, `${execution.run.id}:handoff:${role}`, mode === 'report' ? input.result_ref : undefined);
        job = state.jobs[role] = { request: {
          title: `${packet.title.slice(0, 70)} · ${member.title}`,
          objective: final && wantsReport ? `${canAsk ? '综合研究与必要补证' : '综合传入的固定研究'}，发布并实际渲染父工作流绑定的经理图表报告。` : '回答本角色问题，复用证据并交接完整 Markdown；必要依赖缺失时暂停原 Run。',
          instructions: roleInstructions(final ? 'manager' : member.role, final && wantsReport, { canAsk, synthesis: final, reportOnly: mode === 'report' }) + (member.instructions ? `\n\n本任务具体职责：${member.instructions}` : '') + (plan.custom && canAsk ? `\n本任务可提问的实际成员：${targets.map(id => `${id}（${plan.members[id].title}）`).join('、')}。使用这些准确 analyst ID；未列成员未参与本次流程。` : ''), input: researchInput,
          model: models[role], plugins: [...new Set([...selection.plugins, ...(canAsk ? [ASK_CALL.pluginId, ...state.research.plugins] : [])])],
          allowedCalls: [...selection.allowedCalls, ...(canAsk ? [ASK_CALL] : [])],
        } };
        await save();
      }
      if (!job.ref) {
        const accepted = await host.capabilities.invoke('host.agent.run', job.request, {
          signal, operationId: `${execution.run.id}:${role}`,
          task: { title: member.title, role, stage: role,
            ...(mode === 'analyze' && collaboration ? { agentId: role } : {}),
            output: final && wantsReport ? { type: 'report', target: 'parent' } : { type: 'none' } },
        });
        check(accepted.type === 'run', 'INVALID_HOST_RESULT', 'A research Agent must return a tracked host Run.');
        job.ref = accepted.run; await save();
        execution.emit('progress', { role, message: `${member.title}已开始` });
        if (mode === 'analyze') for (const previous of Object.values(state.members).filter(value => state.jobs[value.role]?.ref?.id === value.run_ref.id)) {
          execution.emit('handoff', { fromRunId: previous.run_ref.id, toRunId: job.ref.id });
        }
      }
      const result = await waitForMember(host, job.ref, role, signal);
      if (canAsk) state.qa = uniqueQuestions([...(state.qa ?? []), ...await questionAnswers(host, job.ref, { signal, wait: true })]);
      state.members[role] = result;
      delete job.request;
      await save();
    }

    for (const roles of stages) {
      signal?.throwIfAborted();
      await Promise.all(roles.map(member));
    }
    if (wantsReport && !state.reportRef) {
      state.reportRef = await checkedReport(host, state.jobs[synthesis].ref, execution.run);
      await save();
    }
    if (mode === 'analyze' && !state.resultRef) {
      const packet = { ...packetOf(state), ...(input.start_from ? { start_from: input.start_from } : {}), ...(state.reportRef ? { report_ref: state.reportRef } : {}) };
      state.resultRef = await publishPacket(host, packet, `${execution.run.id}:result`, [...packet.source_refs, ...(input.start_from ? [input.start_from.result_ref] : [])]);
      await save();
    }
    const result = { result_ref: mode === 'report' ? input.result_ref : state.resultRef, summary: state.members[synthesis].markdown,
      ...(state.reportRef ? { report_ref: state.reportRef } : {}) };
    execution.emit('artifact', { ref: result.result_ref, label: mode === 'report' ? '原固定研究成果' : input.title });
    return result;
  } catch (error) {
    if (signal?.aborted || error.code === 'RUN_INTERRUPTED') throw error;
    await saving;
    return execution.interrupt({ reason: error.message, state, requirements: [{ id: error.code ?? 'RESEARCH_UNAVAILABLE', available: false, reason: error.message }] });
  }
}
