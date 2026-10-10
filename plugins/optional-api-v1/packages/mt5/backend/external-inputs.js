import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { canonical, digest } from '@sesame/plugin-sdk/protocol';
import { requireValue } from './support.js';

export const EXTERNAL_INPUT_FORMAT = 'sesame.mt5.external-input/1';
export const TIMELINE_PATH = 'inputs/svl-timeline.ndjson';
const same = (a, b) => canonical(a) === canonical(b);
const fields = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && same(Object.keys(value).sort(), [...names].sort());
const hash = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
export function frozenTimeline(events) {
  let previous = -1;
  return events.map(event => {
    const availableAtMs = event.availableAt?.basis === 'utc' ? event.availableAt.unixMs : null;
    requireValue(Number.isSafeInteger(availableAtMs) && availableAtMs >= 0 && availableAtMs >= previous, '冻结外部输入需要非递减 UTC availableAt；不得从 broker wall time 推算'); previous = availableAtMs;
    // Fixed wire order lets the bounded MQL reader expose payload only at its availability time.
    return JSON.stringify({ availableAtMs, digest: digest(event), eventId: event.eventId }).slice(0, -1) + ',\"event\":' + canonical(event) + '}';
  }).join('\n') + '\n';
}
export function readTimeline(text) {
  requireValue(typeof text === 'string' && Buffer.byteLength(text) <= 1024 * 1024 && text.endsWith('\n'), '冻结 timeline 必须是最多1MiB、LF结尾的UTF-8 NDJSON');
  const lines = text.slice(0, -1).split('\n');
  requireValue(lines.length > 0 && lines.length <= 10000, '冻结 timeline 大小无效');
  const rows = lines.map(line => { try { return JSON.parse(line); } catch { requireValue(false, '冻结 timeline 含无效JSON'); } });
  requireValue(rows.every(row => fields(row, ['availableAtMs', 'digest', 'eventId', 'event']) && hash(row.digest) && row.digest === digest(row.event) && row.eventId === row.event.eventId), '冻结 timeline 输入身份或摘要不符');
  requireValue(frozenTimeline(rows.map(row => row.event)) === text, '冻结 timeline 必须使用固定线格式和实际输入 availableAt');
  return { events: rows.map(row => row.event), digest: digest(Buffer.from(text)), rows: rows.length };
}

export function externalInputAdaptation(host, source, mode, files, adaptations) {
  if (!source.handlers.some(handler => handler.event.type === 'external.input')) return null;
  const matches = adaptations.filter(item => item.code === 'EXTERNAL_INPUT_BRIDGE');
  requireValue(matches.length === 1 && matches[0].status === 'limited' && matches[0].evidence.length === 1, 'external.input 需要唯一 EXTERNAL_INPUT_BRIDGE limited 声明和固定无密钥配置证据', 422, 'UNSUPPORTED_CAPABILITY');
  const ref = matches[0].evidence[0], artifact = host.artifacts.read(ref), value = artifact.manifest.content;
  requireValue(ref.kind === 'resource' && fields(value, ['format', 'mode', 'clock', 'availability', 'failurePolicy', 'transport']), '外部输入配置必须是固定白名单资源；不要保存地址、token或密码');
  requireValue(value.format === EXTERNAL_INPUT_FORMAT && value.clock === 'utc' && value.availability === 'availableAt-and-expiry' && value.failurePolicy === 'halt_new_risk', '外部输入必须按真实到达/有效期筛选，失败时暂停新增风险');
  if (mode === 'backtest') {
    requireValue(value.mode === 'frozen-timeline' && fields(value.transport, ['path', 'digest']) && value.transport.path === TIMELINE_PATH && hash(value.transport.digest), 'Tester 外部输入必须使用冻结 timeline，不调用模型');
    const timeline = readTimeline(files[TIMELINE_PATH]);
    requireValue(timeline.digest === value.transport.digest, '冻结外部输入配置与翻译文件摘要不同');
    return { configuration: ref, mode: value.mode, timelineDigest: timeline.digest, rows: timeline.rows };
  }
  requireValue(value.mode === 'live-http' && same(value.transport, { protocol: 'sesame.decision/1', endpoint: 'runtime-loopback', authentication: 'runtime-bearer', request: 'async-job', recovery: 'reconcile-before-resubmit' }), 'live 外部输入须声明 loopback 异步job桥、运行时凭据和持久请求恢复');
  requireValue(!Object.hasOwn(files, TIMELINE_PATH), '实时翻译不能隐式复用历史冻结信号');
  return { configuration: ref, mode: value.mode, nativeBridgeVerified: false };
}

/** Stage only immutable translated bytes. No arbitrary user file path is accepted. */
export async function stageFrozenTimeline(mt5, pass, output) {
  const build = mt5.storage.get('mt5_build', pass.build_id, true);
  if (!build) return null; // Legacy isolated Tester acceptance can lack source records.
  const revision = mt5.storage.get('mt5_revision', `${build.project_id}:${build.revision}`);
  if (!Object.hasOwn(revision.files, TIMELINE_PATH)) return null;
  requireValue(revision.translation && mt5.host?.artifacts, '冻结 timeline 需要翻译成果及其固定内容');
  const artifact = mt5.host.artifacts.read(revision.translation), blob = artifact.manifest.blobs.find(blob => blob.path === TIMELINE_PATH);
  requireValue(blob && blob.size <= 1024 * 1024, '翻译成果缺少冻结 timeline');
  const bytes = mt5.host.artifacts.readBlob(blob), timeline = readTimeline(bytes.toString('utf8'));
  requireValue(revision.files[TIMELINE_PATH] === bytes.toString('utf8'), '冻结 revision timeline 与翻译成果不一致');
  await fs.mkdir(join(output, '..'), { recursive: true, mode: 0o700 });
  await fs.mkdir(output, { recursive: false, mode: 0o700 });
  await fs.writeFile(join(output, 'svl-timeline.ndjson'), bytes, { flag: 'wx', mode: 0o600 });
  const staged = await fs.readFile(join(output, 'svl-timeline.ndjson'));
  requireValue(digest(staged) === timeline.digest, '实际Tester timeline 摘要不一致');
  const receipt = { path: TIMELINE_PATH, digest: timeline.digest, rows: timeline.rows, translation: revision.translation };
  mt5.storage.put('mt5_pass', { ...mt5.storage.get('mt5_pass', pass.id), native_input_files: [receipt] });
  return receipt;
}
