import { check } from './composition.js';
import { publishPacket, recordedRefs } from './artifacts.js';
import { TITLES } from './team.js';

const terminal = new Set(['completed', 'cancelled', 'canceled', 'unknown', 'expired', 'superseded']);

export async function memberInput(host, packet, details, operationId, contextRef) {
  const input = { ...details, research: packet };
  if (Buffer.byteLength(JSON.stringify(input)) <= 128 * 1024) return input;
  const ref = contextRef ?? await publishPacket(host, packet, operationId);
  return { ...details, title: packet.title, question: packet.question, subjects: packet.subjects, as_of: packet.as_of,
    context_ref: ref, source_refs: packet.source_refs,
    complete_context: 'Read the complete frozen JSON rows via host.resources.read; this is a reference, not a truncated research summary.' };
}

export async function waitForRun(host, ref, signal) {
  for (;;) {
    signal?.throwIfAborted();
    const { reason, run } = await host.runs.wait(ref, { until: 'settled', timeoutMs: 30000, signal });
    if (reason === 'interrupted' || run.status === 'interrupted') throw Object.assign(new Error(run.interrupts?.find(item => !item.resolvedAt)?.reason ?? 'Research needs its original Run resumed.'), { code: 'RUN_INTERRUPTED' });
    if (!terminal.has(run.status)) continue;
    check(run.status === 'completed', 'RESEARCH_MEMBER_UNFINISHED', `Research ended with ${run.status}; its original Run is retained.`);
    return run;
  }
}

export async function waitForMember(host, ref, role, signal) {
  const run = await waitForRun(host, ref, signal), text = run.output?.result?.text ?? run.output?.text;
  check(typeof text === 'string' && text.trim(), 'RESEARCH_OUTPUT_MISSING', `${TITLES[role]} did not return its required Markdown research output.`);
  return { role, markdown: text, run_ref: ref, source_refs: await recordedRefs(host, ref) };
}
