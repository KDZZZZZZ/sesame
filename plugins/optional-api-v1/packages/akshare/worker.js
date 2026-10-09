import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const AKSHARE_VERSION = '1.19.1';
function run(executable, args, { signal, directory }, input) {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, ['-B', ...args], { cwd: directory, signal, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONNOUSERSITE: '1', TMPDIR: directory, TEMP: directory, TMP: directory, PIP_CONFIG_FILE: process.platform === 'win32' ? 'NUL' : '/dev/null' } });
        let stdout = '', stderr = '', bytes = 0;
        child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 32 * 1024 * 1024) {
            child.kill();
            reject(Error('Worker output exceeds 32 MiB'));
        }
        else
            stdout += chunk; });
        child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000); });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve(stdout) : reject(Object.assign(Error(`Python failed (${code}): ${stderr}`), { code: 'SOURCE_UNAVAILABLE' })));
        child.stdin.end(input ? JSON.stringify(input) : undefined);
    });
}
const inspect = async (python, context) => JSON.parse(await run(python, ['-I', '-c', 'import json,sys,struct,platform; print(json.dumps({"version":list(sys.version_info[:3]),"bits":struct.calcsize("P")*8,"platform":sys.platform,"arch":platform.machine()}))'], context));

const candidates = (payload,context,privatePython,selected) => [...new Set((payload.pythonPath ? [payload.pythonPath] : [selected?.python,privatePython,context.pythonPath,...(process.platform==='win32'?['python.exe']:['python3.13','python3.12','python3.11','python3'])]).filter(Boolean))];
async function discover(payload,context,privatePython,selectionPath) {
    let selected;try{selected=JSON.parse(await readFile(selectionPath,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
    const failures=[];
    for(const candidate of candidates(payload,context,privatePython,selected)) {
        try {
            const info=await inspect(candidate,context);
            if(info.bits!==64||info.version[0]!==3||info.version[1]<11||info.platform!==process.platform)throw Error('Native 64-bit Python >=3.11 required');
            const imported=JSON.parse(await run(candidate,['-I','-c','import akshare,json,sys; print(json.dumps({"python":sys.executable,"version":akshare.__version__}))'],context));
            if(imported.version!==AKSHARE_VERSION)throw Error('AKShare version mismatch: '+imported.version+'; existing environment will not be upgraded');
            const result={ready:true,reused:true,mode:'existing-readonly',python:imported.python,akshareVersion:imported.version,pythonInfo:info,provenance:'Existing environment; download hashes unavailable; verified actual import/version'};
            await writeFile(selectionPath,JSON.stringify(result,null,2)+'\n',{mode:0o600});return result;
        } catch(e){failures.push({python:candidate,reason:e.message.slice(-600)})}
    }
    return {ready:false,required:'No compatible existing AKShare environment. Explicit akshare_prepare installs only into plugin private data.',failures};
}

async function perform(payload, context) {
    await mkdir(context.directory, { recursive: true });
    const root = join(context.directory, 'python-akshare-' + AKSHARE_VERSION), python = join(root, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    try {
        if ((await lstat(root)).isSymbolicLink())
            throw Error('Environment directory may not be a symlink');
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
    }
    const receiptPath = join(root, 'sesame-install-receipt.json'), selectionPath=join(context.directory,'akshare-python-selection.json');
    if(payload.operation==='discover')return discover(payload,context,python,selectionPath);
    if (payload.operation === 'prepare') {
        const existing=await discover(payload,context,python,selectionPath);
        if(existing.ready){if(existing.python===python){existing.receipt=JSON.parse(await readFile(receiptPath,'utf8'));existing.mode='private-venv';}return existing;}
        try {
            const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
            const version = JSON.parse(await run(python, ['-I', '-c', 'import akshare,json; print(json.dumps(akshare.__version__))'], context));
            if (version !== AKSHARE_VERSION)
                throw Error('Installed version changed');
            const packages = JSON.parse(await run(python, ['-I', '-c', 'import importlib.metadata,json; print(json.dumps({d.metadata["Name"].lower().replace("_","-"):d.version for d in importlib.metadata.distributions()}))'], context));
            if (receipt.packages.some(p => packages[p.name.toLowerCase().replaceAll('_', '-')] !== p.version))
                throw Error('Installed dependency versions differ from pinned receipt');
            return { ready: true, reused: true, python, receipt };
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        const candidates = payload.pythonPath ? [payload.pythonPath] : [context.pythonPath, ...(process.platform === 'win32' ? ['python.exe'] : ['python3.13', 'python3.12', 'python3.11', 'python3'])].filter(Boolean);
        let base, system;
        const failures = [];
        for (const candidate of candidates) {
            try {
                const info = await inspect(candidate, context);
                if (info.bits !== 64 || info.version[0] !== 3 || info.version[1] < 11 || info.platform !== process.platform)
                    throw Error('Needs native 64-bit Python >=3.11');
                base = candidate;
                system = info;
                break;
            }
            catch (e) {
                failures.push(`${candidate}: ${e.message}`);
            }
        }
        if (!base)
            throw Object.assign(Error('No compatible host Python. Bundled Linux guest Python cannot be executed on macOS/Windows. Configure a native 64-bit Python >=3.11. ' + failures.join('; ')), { code: 'UNSUPPORTED_PLATFORM' });
        await run(base, ['-I', '-m', 'venv', root], context);
        const report = join(root, 'pip-report.json');
        await run(python, ['-I', '-m', 'pip', '--isolated', 'install', '--index-url', 'https://pypi.org/simple', '--prefer-binary', '--no-cache-dir', '--force-reinstall', '--disable-pip-version-check', '--report', report, `akshare==${AKSHARE_VERSION}`], context);
        const installed = JSON.parse(await readFile(report, 'utf8'));
        const packages = installed.install.map(item => ({ name: item.metadata.name, version: item.metadata.version, url: item.download_info.url, hashes: item.download_info.archive_info.hashes }));
        if (packages.some(item => new URL(item.url).hostname !== 'files.pythonhosted.org' || !item.hashes?.sha256))
            throw Error('Dependency receipt contains a non-official PyPI source or missing SHA256');
        await run(python, ['-I', '-m', 'pip', 'check'], context);
        const receipt = { schemaVersion: 1, akshareVersion: AKSHARE_VERSION, python: system, index: 'https://pypi.org/simple', packages, installedAt: new Date().toISOString() };
        await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
        await writeFile(selectionPath,JSON.stringify({python,mode:'private-venv',akshareVersion:AKSHARE_VERSION},null,2)+'\n',{mode:0o600});
        return { ready: true, reused: false, mode:'private-venv', python, receipt };
    }
    if (payload.operation === 'status') return discover(payload,context,python,selectionPath);
    if (payload.operation !== 'query')
        throw Error('Unknown worker operation');
    let selection;try{selection=JSON.parse(await readFile(selectionPath,'utf8'))}catch{throw Object.assign(Error('AKShare is not prepared. Call akshare_discover or akshare_prepare first; activation never downloads dependencies.'),{code:'ENVIRONMENT_UNAVAILABLE'})}
    const output = await run(selection.python, ['-I', fileURLToPath(new URL('./bridge.py', import.meta.url))], context, payload);
    const result = JSON.parse(output);
    if(result.ok&&result.akshareVersion!==AKSHARE_VERSION)throw Object.assign(Error('Existing AKShare version changed; rediscover without upgrading shared environment'),{code:'ENVIRONMENT_CHANGED'});
    if (!result.ok)
        throw Object.assign(Error(result.error), { code: 'SOURCE_UNAVAILABLE' });
    return result;
}
const preparations = new Map();
export async function execute(payload, context) { if (payload.operation !== 'prepare')
    return perform(payload, context); const previous = preparations.get(context.directory) ?? Promise.resolve(); const task = previous.catch(() => { }).then(() => perform(payload, context)); preparations.set(context.directory, task); try {
    return await task;
}
finally {
    if (preparations.get(context.directory) === task)
        preparations.delete(context.directory);
} }
