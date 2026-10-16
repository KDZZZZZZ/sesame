import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { stat } from 'node:fs/promises';

const encoded = script => Buffer.from(script, 'utf16le').toString('base64');
const powershell = (script, env = {}) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded(script)],
  { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }).trim();

export const currentSid = () => powershell("$ProgressPreference='SilentlyContinue'; [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value");

export function acl(path) {
  const json = powershell(`
    $ProgressPreference = 'SilentlyContinue'
    $path = [System.IO.Path]::GetFullPath($env:MT5AGENT_ACL_PATH)
    $item = Get-Item -LiteralPath $path -Force
    $acl = if ($item.PSIsContainer) { [System.IO.Directory]::GetAccessControl($path) } else { [System.IO.File]::GetAccessControl($path) }
    @($acl.Access | ForEach-Object {
      $sid = $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
      [pscustomobject]@{ Sid = $sid; Inherited = $_.IsInherited; Type = $_.AccessControlType.ToString() }
    }) | ConvertTo-Json -Compress
  `, { MT5AGENT_ACL_PATH: path });
  return JSON.parse(json || '[]');
}

export async function assertPrivatePath(path, { inherited = false } = {}) {
  if (process.platform !== 'win32') {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    return;
  }
  const allowed = new Set([currentSid(), 'S-1-5-18', 'S-1-5-32-544']);
  const entries = acl(path).filter(entry => entry.Type === 'Allow');
  assert.ok(entries.length >= allowed.size, `${path} should have trusted ACL entries`);
  assert.ok(entries.every(entry => allowed.has(entry.Sid)), `${path} must not grant untrusted principals: ${JSON.stringify(entries)}`);
  assert.ok(entries.every(entry => entry.Inherited === inherited), `${path} inheritance state should be ${inherited}`);
}
