// MetaEditor remains the compiler of record. This only locates its diagnostics;
// unrecognized log formats remain available as text and are never called success.
export function compilerDiagnostics(log) {
  return String(log).split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*(.*?)\((\d+),(\d+)\)\s*:\s*(error|warning)\s*(\d+)?\s*:\s*(.*)$/i);
    if (!match) return [];
    const normalized = match[1].replaceAll('\\', '/').replace(/^Z:\/build\//i, '');
    return [{ file: normalized, line: Number(match[2]), column: Number(match[3]), severity: match[4].toLowerCase(), code: match[5] ?? null, message: match[6] }];
  });
}

export function compileFailure(build) {
  const diagnostics = compilerDiagnostics(build.diagnostics).map(item => {
    const source = item.file.endsWith('Product/VisualStrategy.mqh') ? build.source_map?.[item.line] : null;
    return source ? { ...item, generated_file: item.file, generated_line: item.line, file: source.file, line: source.line, column: source.column, node_id: source.node_id ?? null } : item;
  });
  const errors = diagnostics.filter(item => item.severity === 'error');
  const selected = errors.length ? errors : diagnostics;
  const environment = !errors.length && /Native runtime|Runtime (boot|request) timeout|runtime_cleanup_failed|compiler bootstrap|运行环境|隔离环境/i.test(build.diagnostics);
  const result = {
    code: 'compile_failed', recoverable: true,
    failure_kind: errors.length ? 'source' : environment ? 'environment' : 'unknown',
    message: environment ? '隔离编译环境未完成运行或清理，这不是策略源码错误。保留当前版本并检查环境诊断，不要反复修改策略或创建相同构建；环境恢复后再编译。未确认的 EX5 不能用于回测或挂载。'
      : errors.length ? 'MetaEditor 编译未通过。根据诊断修改当前 checkout，save 新 revision 后重新调用 mt5_compile；不要对未修改的同一版本盲目重试。'
        : '编译未完成，暂无可定位的源码错误。先读取完整诊断确认原因，不要盲目修改策略或重试；未确认产物不能用于回测或挂载。',
    project_id: build.project_id, build_id: build.id, revision: build.revision,
    diagnostics: selected.slice(0, 20).map(item => ({ ...item, file: item.file.slice(0, 256), message: item.message.slice(0, 1000) })),
    diagnostics_truncated: selected.length > 20 || selected.slice(0, 20).some(item => item.file.length > 256 || item.message.length > 1000),
    log_excerpt: String(build.diagnostics).slice(-6000),
    full_diagnostics: { tool: 'mt5_inspect', arguments: { build_id: build.id } },
  };
  // Error messages bypass normal successful-tool truncation in Pi. Bound this
  // JSON too, including escaped or non-ASCII source text from compiler errors.
  while (Buffer.byteLength(JSON.stringify(result)) > 32 * 1024) {
    if (result.diagnostics.length) { result.diagnostics.pop(); result.diagnostics_truncated = true; }
    else result.log_excerpt = result.log_excerpt.slice(Math.ceil(result.log_excerpt.length / 2));
  }
  return result;
}
