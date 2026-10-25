import { execFile } from 'node:child_process';
import { win32 } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
// Pass the selected path as data, never as interpolated PowerShell code. Query
// by executable name, then compare full paths so other installations do not count.
const inspectScript = Buffer.from(`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$terminalName = [System.IO.Path]::GetFileName($env:SESAME_MT5_INSPECT_PATH)
$items = @(Get-CimInstance -ClassName Win32_Process | Where-Object { $_.Name -ieq $terminalName } | Select-Object ProcessId, ExecutablePath)
ConvertTo-Json -InputObject $items -Compress
`, 'utf16le').toString('base64');

/** Read-only process evidence; missing permissions or unsupported platforms are unknown, never absent. */
export async function inspectTerminalProcess(native, signal, { platform = process.platform, execProcess = execute } = {}) {
  signal?.throwIfAborted();
  const result = { status: 'unknown', running: null, terminal_path: native?.terminal ?? null, pids: [], checked_at: new Date().toISOString() };
  if (!native?.terminal) return { ...result, reason: '尚未选择本机终端路径，无法确认终端进程' };
  if (platform !== 'win32') return { ...result, reason: '当前平台无法确认所选终端进程，不能据此判为未启动' };
  try {
    const { stdout } = await execProcess(win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', inspectScript],
      { env: { ...process.env, SESAME_MT5_INSPECT_PATH: native.terminal }, signal, timeout: 5000, maxBuffer: 65536, windowsHide: true });
    const rows = JSON.parse(stdout.replace(/^\uFEFF/, ''));
    if (!Array.isArray(rows) || rows.some(row => !row || !Number.isSafeInteger(row.ProcessId) || row.ProcessId < 1
      || row.ExecutablePath != null && typeof row.ExecutablePath !== 'string')) throw new Error('Invalid process evidence');
    const target = win32.normalize(native.terminal).toLowerCase();
    const pids = rows.filter(row => row.ExecutablePath && win32.normalize(row.ExecutablePath).toLowerCase() === target).map(row => row.ProcessId);
    const running = pids.length ? true : rows.some(row => !row.ExecutablePath) ? null : false;
    return { ...result, running, pids, status: running === null ? 'unknown' : running ? 'running' : 'not_running',
      ...(running === null ? { reason: '同名进程路径不可读，无法确认是否为所选终端' } : {}) };
  } catch {
    signal?.throwIfAborted();
    return { ...result, reason: '无法读取所选终端进程状态，不能据此判为未启动' };
  }
}
