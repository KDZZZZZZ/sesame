import { randomUUID, createHash } from 'node:crypto';
import { existsSync, lstatSync, realpathSync, promises as fs } from 'node:fs';
import { resolve, dirname, parse, join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

export const now = () => new Date().toISOString();
export const id = prefix => `${prefix}_${randomUUID()}`;
export const digest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const requireValue = (condition, message, status = 422, code = 'invalid_request') => {
  if (!condition) throw new ApiError(status, code, message);
};
const encodePowerShell = script => Buffer.from(script, 'utf16le').toString('base64');
const ACL_SCRIPT = encodePowerShell(`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$path = [System.IO.Path]::GetFullPath($env:MT5AGENT_SECURE_PATH)
$item = Get-Item -LiteralPath $path -Force
if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'refuse_reparse_point' }
$isDirectory = $item.PSIsContainer
$rights = [System.Security.AccessControl.FileSystemRights]::FullControl
$inherit = if ($isDirectory) { [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' } else { [System.Security.AccessControl.InheritanceFlags]::None }
$propagation = [System.Security.AccessControl.PropagationFlags]::None
$allow = [System.Security.AccessControl.AccessControlType]::Allow
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [System.Security.Principal.SecurityIdentifier]'S-1-5-18'
$admins = [System.Security.Principal.SecurityIdentifier]'S-1-5-32-544'
$security = if ($isDirectory) { [System.Security.AccessControl.DirectorySecurity]::new() } else { [System.Security.AccessControl.FileSecurity]::new() }
$security.SetAccessRuleProtection($true, $false)
foreach ($sid in @($current, $system, $admins)) {
  $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid, $rights, $inherit, $propagation, $allow))
}
if ($isDirectory) { [System.IO.Directory]::SetAccessControl($path, $security) } else { [System.IO.File]::SetAccessControl($path, $security) }
`);
export function securePath(path) {
  if (process.platform !== 'win32' || !existsSync(path)) return;
  const full = resolve(path);
  const stat = lstatSync(full);
  requireValue(!stat.isSymbolicLink(), '拒绝收紧重解析路径 ACL');
  const real = realpathSync.native(full);
  const home = realpathSync.native(homedir());
  const root = parse(real).root;
  requireValue(real !== root && real.toLowerCase() !== home.toLowerCase() && dirname(real) !== real, '拒绝收紧非应用数据目录 ACL');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', ACL_SCRIPT],
    { timeout: 10000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MT5AGENT_SECURE_PATH: full } });
}


export async function readTree(directory, prefix = '', files = {}) {
  for (const entry of await fs.readdir(join(directory, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await readTree(directory, name, files);
    else { requireValue(entry.isFile(), '包资源不能包含链接或特殊文件'); files[name] = await fs.readFile(join(directory, name)); }
  }
  return files;
}
export const taskRunId = value => { requireValue(/^run_[0-9a-f-]{36}$/.test(value), '运行任务 ID 无效'); return value; };
export const rowSchema = rows => ({ type: 'object', properties: Object.fromEntries([...new Set(rows.flatMap(Object.keys))].map(key => [key, {}])), additionalProperties: false });
