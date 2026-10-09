import { posix } from 'node:path';
import { check, digest } from '@sesame/plugin-sdk/protocol';

const queues = new Map(), MAX_BYTES = 50000, MAX_LINES = 2000;
function serial(key, action) {
  const task = (queues.get(key) ?? Promise.resolve()).then(action), tail = task.catch(() => {});
  queues.set(key, tail); void tail.finally(() => { if (queues.get(key) === tail) queues.delete(key); }); return task;
}
export function replacements(original, edits) {
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '', text = original.slice(bom.length).replaceAll('\r\n', '\n');
  const spans = edits.map(({ oldText, newText }) => {
    oldText = oldText.replaceAll('\r\n', '\n'); newText = newText.replaceAll('\r\n', '\n');
    check(oldText.length > 0, 'oldText cannot be empty');
    const start = text.indexOf(oldText); check(start >= 0 && text.indexOf(oldText, start + 1) === -1, 'Each oldText must match exactly one region of the original file');
    return { start, end: start + oldText.length, newText };
  }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) check(spans[i - 1].end <= spans[i].start, 'Edits overlap; combine them into a single replacement');
  let content = text;
  for (const span of spans.toReversed()) content = content.slice(0, span.start) + span.newText + content.slice(span.end);
  return bom + (original.includes('\r\n') ? content.replaceAll('\n', '\r\n') : content);
}
function mime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) return 'image/gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
}
export function createTools(host) {
  const { define, Type, string } = host.tools, box = host.workspace, operations = box.operations;
  const path = name => box.path(name), key = name => `${host.storage.directory}\0${host.scope.conversationId}\0${name}`;
  const read = define('read', '读取工作区文件或已挂载插件的授权资源；文本默认最多 2000 行/50 KB，可用 offset/limit 继续读取。PNG/JPEG/GIF/WebP 作为图片返回。', { path: string('工作区文件路径或宿主返回的插件资源路径'), offset: Type.Optional(Type.Integer({ minimum: 1 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_LINES })) }, () => {});
  read.execute = async (_id, args, signal) => {
    // The host resolves registered resources before enforcing workspace paths.
    // Passing the original path also preserves its active-plugin authorization.
    signal?.throwIfAborted(); const bytes = await operations.readFile(args.path); signal?.throwIfAborted(); const full = args.path;
    const mediaType = mime(bytes);
    if (mediaType) { check(bytes.length <= 8 * 1024 * 1024, 'Image exceeds 8 MiB; resize it in the workspace'); return { content: [{ type: 'image', data: bytes.toString('base64'), mimeType: mediaType }], details: { path: full, mediaType, bytes: bytes.length } }; }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes), lines = text.split('\n'), start = (args.offset ?? 1) - 1;
    check(start <= lines.length, 'offset is beyond the end of the file');
    const selected = []; let size = 0;
    for (const line of lines.slice(start, start + (args.limit ?? MAX_LINES))) { const length = Buffer.byteLength(line) + 1; if (size + length > MAX_BYTES) break; selected.push(line); size += length; }
    check(selected.length > 0 || !text, 'A single line exceeds 50 KB; inspect it with workspace code');
    const next = start + selected.length;
    return { content: [{ type: 'text', text: selected.join('\n') + (next < lines.length ? `\n[Continue with offset=${next + 1}; ${lines.length} total lines.]` : '') }], details: { path: full, offset: start + 1, lines: selected.length, next_offset: next < lines.length ? next + 1 : null, digest: digest(bytes) } };
  };
  return [read,
    define('write', '写入 UTF-8 工作区文件并创建所需父目录。', { path: string('工作区路径'), content: Type.String({ maxLength: 1048576 }) }, (args, signal) => {
      const full = path(args.path);
      return serial(key(full), async () => { signal?.throwIfAborted(); await operations.mkdir(posix.dirname(full)); signal?.throwIfAborted(); await operations.writeFile(full, args.content); return { path: full, bytes: Buffer.byteLength(args.content), digest: digest(args.content) }; });
    }),
    define('edit', '精确替换原文件中唯一且互不重叠的文本；全部匹配通过后一次写入。保留 BOM 和原换行风格。', { path: string('工作区路径'), edits: Type.Array(Type.Object({ oldText: Type.String({ minLength: 1, maxLength: 1048576 }), newText: Type.String({ maxLength: 1048576 }) }, { additionalProperties: false }), { minItems: 1, maxItems: 128 }) }, (args, signal) => {
      const full = path(args.path);
      return serial(key(full), async () => { signal?.throwIfAborted(); const bytes = await operations.readFile(full), content = replacements(new TextDecoder('utf-8', { fatal: true }).decode(bytes), args.edits); signal?.throwIfAborted(); check((await operations.readFile(full)).equals(bytes), 'File changed during edit; read it again'); await operations.writeFile(full, content); return { path: full, replacements: args.edits.length, digest: digest(content) }; });
    }),
    define('bash', '在会话隔离环境中执行 shell；返回真实执行 ID、退出码和输出，非零退出作为工具错误。cwd 可限制为 /work 的子目录。', { command: Type.String({ minLength: 1, maxLength: 100000 }), timeout: Type.Optional(Type.Integer({ minimum: 1, maximum: 600 })), cwd: Type.Optional(Type.String({ maxLength: 1000 })) }, async (args, signal) => {
      const result = await box.run(['/bin/bash', '-c', args.command], { signal, timeout: args.timeout ?? 60, cwd: args.cwd });
      const output = result.output ?? '';
      const details = { execution_id: result.executionId, exit_code: result.exitCode, output: Buffer.byteLength(output) > MAX_BYTES ? Buffer.from(output).subarray(-MAX_BYTES).toString('utf8') : output, truncated: Buffer.byteLength(output) > MAX_BYTES };
      if (result.exitCode !== 0) throw Object.assign(new Error(`Command exited with code ${result.exitCode}; execution_id=${result.executionId}\n${details.output}`), { code: 'PROCESS_EXIT', details });
      return details;
    }),
  ];
}
