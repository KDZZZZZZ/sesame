import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { assert,relativeFile } from './replay.mjs';

// The judge stays in the parent. Only verified package bytes and this adapter
// enter the namespace. The candidate receives no inherited handles or host API.
const adapter = String.raw`
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const params = JSON.parse(readFileSync(0,'utf8'));
if (params.server) {
  const { spawn } = await import('node:child_process');
  const { createInterface } = await import('node:readline');
  const server=params.server;
  const child=spawn('/bin/'+server.command,server.args,{cwd:'/package',env:{HOME:'/tmp',PATH:'/bin',PYTHONDONTWRITEBYTECODE:'1'},stdio:['pipe','pipe','ignore']});
  const reader=createInterface({input:child.stdout});
  const lines=reader[Symbol.asyncIterator]();
  async function rpc(id,method,body) {
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params:{...body,_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}}}})+'\n');
    for(;;) {
      const line=await lines.next();
      if(line.done || line.value.length>1048576) throw Error('Invalid sandbox MCP response');
      const msg=JSON.parse(line.value);
      if(msg.id!==id) continue;
      if(msg.error) throw Error('Sandbox MCP request failed: '+msg.error.code);
      return msg.result;
    }
  }
  try {
    await rpc(1,'server/discover',{});
    const result=await rpc(2,'tools/call',{name:params.binding,arguments:params.arguments});
    process.stdout.write(JSON.stringify(result));
  } finally {reader.close();child.kill('SIGKILL');}
} else {
const mod = await import(pathToFileURL('/package/' + params.entry));
const caps = mod.createCapabilities(Object.freeze({context:Object.freeze({workspaceRoot:'/tmp',storageRoot:'/tmp',pluginRoot:'/package'})}));
const tool = caps.find(item=>item.name===params.binding);
if (!tool) throw Error('Missing declared native binding');
const value = await tool.execute(params.arguments,AbortSignal.timeout(5000));
process.stdout.write(JSON.stringify({structuredContent:value,content:[{type:'text',text:JSON.stringify(value)}],isError:false}));
}
`;
function isolationRuntime(root) {
  if(process.platform==='linux') return {launcher:'/usr/bin/prlimit',prefix:[],root,node:realpathSync(process.execPath),env:{PATH:'/usr/bin:/bin',LANG:'C'}};
  assert(process.platform==='win32','Sandbox requires Linux or WSL2 with bubblewrap and prlimit');
  const launcher=join(process.env.SystemRoot,'System32','wsl.exe');
  const distro=process.env.SESAME_SANDBOX_DISTRO??'MT5Agent';
  assert(/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(distro),'Invalid sandbox distribution name');
  const prefix=['--distribution',distro,'--cd','/','--exec'];
  // Resolve the staging path and trusted interpreter before mounting anything.
  const probe=spawnSync(launcher,[...prefix,'/usr/bin/env','-i','PATH=/usr/local/bin:/usr/bin:/bin','/bin/sh','-c','wslpath -u "$1" && command -v node','sandbox-location',realpathSync.native(root)],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert(probe.status===0,'WSL sandbox unavailable for distribution '+distro);
  const [mount,node]=probe.stdout.trim().split(/\r?\n/);
  assert(mount?.startsWith('/')&&node?.startsWith('/'),'WSL sandbox paths unavailable');
  return {launcher,prefix:[...prefix,'/usr/bin/prlimit'],root:mount,node,env:{SystemRoot:process.env.SystemRoot}};
}
export function sandboxCall(pkg, params) {
  const cap = pkg.capabilities.capabilities.find(item => item.id === params.name && item.consumers.includes('agent'));
  assert(cap && ['mcp','native'].includes(cap.binding.type) && cap.execution==='immediate','Sandbox requires a declared immediate native or stdio tool');
  let server;
  if(cap.binding.type==='native') assert(Object.hasOwn(pkg.files,pkg.manifest.entry),'Sandbox entry missing');
  else {
    const declared=JSON.parse(pkg.files['mcp.json']).mcpServers?.[cap.binding.server];
    assert(declared?.type==='stdio' && ['node','python3'].includes(declared.command) && Array.isArray(declared.args) && declared.args.every(arg=>typeof arg==='string'),'Unsupported sandbox MCP server');
    server={command:declared.command,args:declared.args.map(arg=>arg.replaceAll('${PLUGIN_ROOT}','/package'))};
  }
  const root = mkdtempSync(join(tmpdir(),'sesame-case-'));
  try {
    const stage = join(root,'package');
    for (const [path, bytes] of Object.entries(pkg.files)) {
      relativeFile(path);
      mkdirSync(dirname(join(stage,path)),{recursive:true});
      writeFileSync(join(stage,path),bytes);
    }
    const runner = join(root,'run.mjs');
    writeFileSync(runner,adapter);
    const runtime=isolationRuntime(root);
    const flags = ['--unshare-all','--die-with-parent','--new-session','--clearenv','--cap-drop','ALL','--uid','65534','--gid','65534',
      '--ro-bind','/usr/lib','/usr/lib','--symlink','usr/lib','/lib','--ro-bind-try','/usr/lib64','/usr/lib64','--symlink','usr/lib64','/lib64',
      '--ro-bind',runtime.node,'/bin/node',...(server?.command==='python3'?['--ro-bind','/usr/bin/python3','/bin/python3']:[]),'--ro-bind',runtime.root+'/package','/package','--ro-bind',runtime.root+'/run.mjs','/run.mjs',
      '--dev','/dev','--proc','/proc','--tmpfs','/tmp','--chdir','/tmp','--setenv','HOME','/tmp','--','/bin/node','--max-old-space-size=128','--disable-wasm-trap-handler','/run.mjs'];
    const result = spawnSync(runtime.launcher,[...runtime.prefix,'--as=4294967296','--cpu=8','--fsize=4194304','--nofile=64','--nproc=48','--','/usr/bin/bwrap',...flags],{
      env:runtime.env,windowsHide:true,input:JSON.stringify({entry:pkg.manifest.entry,server,binding:cap.binding.name,arguments:params.arguments ?? {}}),encoding:'utf8',maxBuffer:2*1024*1024,timeout:10000,killSignal:'SIGKILL'});
    assert(!result.error && result.status === 0,'Isolated call failed: ' + (result.error?.code ?? result.stderr?.slice(-500)));
    return JSON.parse(result.stdout);
  } finally { rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}); }
}
