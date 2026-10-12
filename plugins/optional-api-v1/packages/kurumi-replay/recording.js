// 完整素材归档：串行哈希链日志（全元数据摘要）、fsync 真实落盘、严格不覆盖文件、
// SQLite 一次一致快照双字节复制、故障锁定与镜像前缀恢复、封存重试字节核查。
// 原始证据权威副本在插件持久目录 recording/，镜像同步到用户素材目录。
// 关键数据过预算/丢失/写盘失败一律抛出，由服务层暂停付费回合并阻断清理，绝不静默跳过。
import { createHash } from 'node:crypto';
import { promises as fs, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DEFAULT_MIRROR = 'recording-mirror'; // relative to this installation's private storage, never an author path
const ZERO = 'sha256:' + '0'.repeat(64);
const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const failure = (code, message) => Object.assign(new Error(message), { code });

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value === undefined ? null : value);
}

// 防御层：宣传素材绝不包含 API 密钥、账户密码或模型登录配置。
// 模型 {provider,id,configurationDigest} 是身份描述符不是密钥，保留；
// 角色步骤 authorization 是步骤幂等身份而非账户凭据，保留。
const SENSITIVE_KEY = /(?:password|passwd|secret|token|api[_-]?key|credential|private[_-]?key|session[_-]?key)/i;
export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) out[key] = '[redacted]';
      else out[key] = redactSecrets(item);
    }
    return out;
  }
  return value;
}

async function exists(path) { try { await fs.lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }

async function journalTail(path) {
  const info=await fs.stat(path).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(!info?.size)return{seq:0,prevDigest:ZERO,size:0};
  const handle=await fs.open(path,'r');
  try{const last=Buffer.alloc(1);await handle.read(last,0,1,info.size-1);if(last[0]!==10)throw failure('ARCHIVE_JOURNAL_CORRUPT', '归档日志尾部不完整；保留现场，不续写');}
  finally{await handle.close();}
  let seq = 0, prevDigest = ZERO;
  // Decode incrementally (including split UTF-8), bounded by one record rather
  // than the entire journal. Long recordings exceed V8's maximum string size.
  const input=createReadStream(path,{encoding:'utf8'});
  const lines=createInterface({input,crlfDelay:Infinity});
  try{for await (const line of lines) {
    if(!line)continue;
    let row;
    try { row = JSON.parse(line); } catch { throw failure('ARCHIVE_JOURNAL_CORRUPT', `归档日志第 ${seq + 1} 行不是完整 JSON`); }
    const { digest, ...body } = row;
    if (row.seq !== seq + 1 || row.prevDigest !== prevDigest || digest !== sha(Buffer.from(canonical(body))))
      throw failure('ARCHIVE_JOURNAL_CORRUPT', `归档日志第 ${seq + 1} 行序号或摘要不一致`);
    seq = row.seq; prevDigest = digest;
  }}finally{lines.close();input.destroy();}
  const after=await fs.stat(path);
  if(after.size!==info.size||after.mtimeMs!==info.mtimeMs)throw failure('ARCHIVE_JOURNAL_CHANGED','核验时权威日志发生变化；不拼接不同版本');
  return { seq, prevDigest, size:info.size };
}

async function readExact(handle,position,length){
  const bytes=Buffer.alloc(length);let offset=0;
  while(offset<length){const result=await handle.read(bytes,offset,length-offset,position+offset);if(!result.bytesRead)throw failure('ARCHIVE_MIRROR_LOCKED','归档核验期间文件缩短；不自动改写');offset+=result.bytesRead;}
  return bytes;
}

export class Recorder {
  /** rootDirectory 是插件持久目录（host.storage.directory）。 */
  constructor(rootDirectory, { mirrorRoot } = {}) {
    if (typeof rootDirectory !== 'string' || !rootDirectory) throw failure('INVALID_STORAGE', '归档需要插件持久目录');
    this.root = join(rootDirectory, 'recording');
    this.mirror = mirrorRoot ?? join(rootDirectory, DEFAULT_MIRROR);
    this.journalName = 'journal.ndjson';
    this.seq = 0;
    this.prevDigest = ZERO;
    this.initialized = false;
    this.initializing = null;
    this.queue = Promise.resolve();
    this.locked = null; // 镜像写失败后的故障锁定：{seq,error}
  }

  /** 共享同一进行中的初始化；重放整本日志逐行校验（重启后不信任尾部）。 */
  initialize() {
    if (this.initialized) return Promise.resolve();
    if (this.initializing) return this.initializing;
    this.initializing = this.#initialize().catch(error => { this.initializing = null; throw error; });
    return this.initializing;
  }

  async #initialize() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    await fs.mkdir(join(this.root, 'private'), { recursive: true, mode: 0o700 });
    await fs.mkdir(this.mirror, { recursive: true, mode: 0o700 });
    // A prior process may have exited after the primary fsync and before mirror fsync.
    // Reconcile both copies on every fresh instance, not only an in-memory failure.
    await this.#recoverMirror();
    this.initialized = true;
  }

  /** 追加一条哈希链记录：串行化；序号/墙钟UTC/模拟时钟/前哈希/种类/载荷全部进入本条摘要。 */
  append(kind, payload, { simClockMs = null } = {}) {
    const run = this.queue.then(() => this.#append(kind, payload, { simClockMs }));
    this.queue = run.catch(() => {});
    return run;
  }

  async #append(kind, payload, { simClockMs }) {
    await this.initialize();
    if (this.locked) await this.#recoverMirror(); // 恢复失败直接抛出，不写权威日志
    const safe = redactSecrets(payload);
    const body = { seq: this.seq + 1, wallClockUtc: new Date().toISOString(), simClockMs, prevDigest: this.prevDigest, kind, payload: safe };
    const record = { ...body, digest: sha(Buffer.from(canonical(body))) };
    const line = JSON.stringify(record) + '\n';
    try { await this.#appendLine(join(this.root, this.journalName), line); }
    catch (e) {
      this.initialized = false; this.initializing = null;
      throw failure('ARCHIVE_WRITE_FAILED', '归档写盘失败（权威副本）：' + e.message);
    }
    this.seq = record.seq;
    this.prevDigest = record.digest;
    try { await this.#appendLine(join(this.mirror, this.journalName), line); }
    catch (e) {
      // 权威副本已含本行；锁定并拒绝后续写入，直到镜像前缀被核对/补齐。
      this.locked = { seq: record.seq, error: e.message };
      throw failure('ARCHIVE_MIRROR_FAILED', '归档镜像写盘失败，已故障锁定：' + e.message);
    }
    this.seq = record.seq;
    this.prevDigest = record.digest;
    return record;
  }

  /** 真实 fsync 落盘；写失败截断回写入前大小，不留半截行。 */
  async #appendLine(path, line) {
    const before = (await fs.stat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; }))?.size ?? 0;
    const handle = await fs.open(path, 'a');
    try {
      await handle.writeFile(line);
      await handle.sync();
      if (before === 0) {
        // This is part of the append transaction: a directory-sync failure must
        // roll the line back before the service queues it as unwritten.
        const dir = await fs.open(dirname(path), 'r');
        try { await dir.sync(); } finally { await dir.close(); }
      }
    } catch (e) {
      try { await handle.truncate(before); await handle.sync(); } catch { /* 保留诊断 */ }
      throw e;
    } finally { await handle.close(); }
  }

  /** 镜像恢复：镜像必须是权威日志的严格前缀；缺失行按权威字节补齐，不一致抛出。 */
  async #recoverMirror() {
    const primaryPath=join(this.root,this.journalName),mirrorPath=join(this.mirror,this.journalName);
    const tail=await journalTail(primaryPath);
    const info=await fs.stat(mirrorPath).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    const mirrorSize=info?.size??0,chunkSize=1024*1024;
    if(mirrorSize>tail.size)throw failure('ARCHIVE_MIRROR_LOCKED','归档镜像长于权威副本；不自动改写');
    if(tail.size){
      const source=await fs.open(primaryPath,'r');let mirror=null;
      try{
        if(mirrorSize){
          mirror=await fs.open(mirrorPath,'r');
          if((await readExact(mirror,mirrorSize-1,1))[0]!==10)throw failure('ARCHIVE_MIRROR_LOCKED','归档镜像尾部不完整；不自动改写');
          for(let offset=0;offset<mirrorSize;offset+=chunkSize){const length=Math.min(chunkSize,mirrorSize-offset);if(!(await readExact(source,offset,length)).equals(await readExact(mirror,offset,length)))throw failure('ARCHIVE_MIRROR_LOCKED','归档镜像与权威副本前缀不一致；不自动改写');}
          await mirror.close();mirror=null;
        }
        if(mirrorSize<tail.size){
          mirror=await fs.open(mirrorPath,'a');
          try{
            for(let offset=mirrorSize;offset<tail.size;offset+=chunkSize)await mirror.writeFile(await readExact(source,offset,Math.min(chunkSize,tail.size-offset)));
            await mirror.sync();
          }catch(error){await mirror.truncate(mirrorSize);await mirror.sync();throw error;}
          if(!mirrorSize){const directory=await fs.open(dirname(mirrorPath),'r');try{await directory.sync();}finally{await directory.close();}}
        }
      }catch(e){throw failure('ARCHIVE_MIRROR_LOCKED','归档镜像核验或补齐失败，保持故障锁定：'+e.message);}
      finally{await source.close();if(mirror)await mirror.close();}
    }
    this.seq = tail.seq;
    this.prevDigest = tail.prevDigest;
    this.locked = null;
  }

  /** 严格不覆盖写：临时文件 + 创建型硬链接落盘；已存在同内容跳过，不同内容拒绝。 */
  async file(relPath, content, { mode = 0o600, skipJournal = false } = {}) {
    await this.initialize();
    if (relPath.includes('..') || relPath.startsWith('/') || relPath.includes('\0')) throw failure('INVALID_ARCHIVE_PATH', '归档相对路径越界');
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    if (bytes.length > 512 * 1024 * 1024) throw failure('ARCHIVE_BUDGET', '单个归档文件超过 512 MiB 预算');
    const digest = sha(bytes);
    let reused = true;
    for (const base of [this.root, this.mirror]) {
      const placed = await this.#placeBytes(join(base, relPath), bytes, { mode });
      if (!placed.reused) reused = false;
    }
    return { path: relPath, digest, bytes: bytes.length, reused };
  }

  async #placeBytes(target, bytes, { mode = 0o600 } = {}) {
    const digest = sha(bytes);
    await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
    if (await exists(target)) {
      const prior = await fs.readFile(target);
      if (sha(prior) === digest) return { reused: true };
      throw failure('ARCHIVE_CONFLICT', '归档文件已存在且内容不同，不覆盖旧版本：' + target);
    }
    const tmp = target + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const handle = await fs.open(tmp, 'wx', mode);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } catch (e) {
      await handle.close().catch(() => {});
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw failure('ARCHIVE_WRITE_FAILED', '归档写盘失败（' + target + '）：' + e.message);
    }
    await handle.close();
    try {
      await fs.link(tmp, target); // 创建型落盘：目标已存在则失败，绝不覆盖竞争者
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      if (e.code === 'EEXIST') {
        const prior = await fs.readFile(target).catch(() => null);
        if (prior && sha(prior) === digest) return { reused: true };
        throw failure('ARCHIVE_CONFLICT', '归档文件竞争创建且内容不同：' + target);
      }
      throw failure('ARCHIVE_WRITE_FAILED', '归档落盘失败（' + target + '）：' + e.message);
    }
    await fs.rm(tmp, { force: true }).catch(() => {});
    // 目录项持久化（尽力而为；失败视为写盘失败）。
    try { const dir = await fs.open(dirname(target), 'r'); try { await dir.sync(); } finally { await dir.close(); } } catch (e) { throw failure('ARCHIVE_WRITE_FAILED', '归档目录持久化失败（' + target + '）：' + e.message); }
    return { reused: false };
  }

  /** SQLite 一致快照：只 VACUUM 一次到临时文件，同一字节写入两处，绝不盲拷活动库文件。 */
  async snapshotSqlite(sourcePath, relPath) {
    // Reuse the first consistent snapshot after a mirror failure. A fresh VACUUM
    // can change SQLite header bytes after cleanup diagnostics have been added.
    for (const base of [this.root, this.mirror]) {
      if (!(await exists(join(base, relPath)))) continue;
      const bytes = await fs.readFile(join(base, relPath));
      const result = await this.file(relPath, bytes);
      return { path: relPath, digest: result.digest, bytes: bytes.length };
    }
    if (!(await exists(sourcePath))) throw failure('ARCHIVE_SOURCE_MISSING', '角色 runtime.sqlite 缺失，不能确认原始输出已封存');
    const staging = join(this.root, relPath + '.snapshot-' + process.pid + '-' + Date.now());
    await fs.mkdir(dirname(staging), { recursive: true, mode: 0o700 });
    await fs.rm(staging, { force: true }).catch(() => {});
    const db = new DatabaseSync(sourcePath);
    try { db.exec(`VACUUM INTO '${staging.replaceAll("'", "''")}'`); }
    catch (e) { throw failure('ARCHIVE_WRITE_FAILED', 'runtime.sqlite 一致快照失败：' + e.message); }
    finally { db.close(); }
    const bytes = await fs.readFile(staging);
    const result = await this.file(relPath, bytes);
    await fs.rm(staging, { force: true }).catch(() => {});
    return { path: relPath, digest: result.digest, bytes: bytes.length };
  }

  /** 完整复制任务目录树（排除单独处理的 runtime.sqlite）；过预算/链接/特殊文件/源缺失一律抛错。 */
  async copyTree(sourceRoot, relDest, { exclude = new Set(['runtime.sqlite']), maxFileBytes = 64 * 1024 * 1024, maxTotalBytes = 256 * 1024 * 1024, allowMissing = false } = {}) {
    const manifest = [];
    let total = 0;
    let sourceStat;
    try { sourceStat = await fs.lstat(sourceRoot); }
    catch (e) {
      if (e.code === 'ENOENT' && allowMissing) return { manifest: [{ path: '', skipped: 'source-absent-recorded' }], totalBytes: 0 };
      if (e.code === 'ENOENT') throw failure('COPY_SOURCE_MISSING', '归档源目录不存在，不能误称完整：' + sourceRoot);
      throw e;
    }
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw failure('COPY_SOURCE_MISSING', '归档源不是真实目录：' + sourceRoot);
    const walk = async (dir, rel) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const source = join(dir, entry.name), relPath = rel ? rel + '/' + entry.name : entry.name;
        if (exclude.has(relPath)) continue;
        const stat = await fs.lstat(source);
        if (stat.isSymbolicLink()) throw failure('UNSAFE_PATH', '任务目录出现符号链接，拒绝归档：' + relPath);
        if (stat.isDirectory()) { await walk(source, relPath); continue; }
        if (!stat.isFile()) throw failure('UNSAFE_PATH', '任务目录出现特殊文件，拒绝归档：' + relPath);
        if (stat.size > maxFileBytes) throw failure('ARCHIVE_BUDGET', `关键文件 ${relPath} 超过单文件归档预算（${stat.size} > ${maxFileBytes}），拒绝静默跳过`);
        if (total + stat.size > maxTotalBytes) throw failure('ARCHIVE_BUDGET', `归档总量超过预算（含 ${relPath}），拒绝静默跳过`);
        const bytes = await fs.readFile(source);
        const digest = sha(bytes);
        const written = await this.file(join(relDest, relPath), bytes, { mode: 0o600 });
        total += bytes.length;
        manifest.push({ path: relPath, digest, bytes: bytes.length, archive: written.path });
      }
    };
    await walk(sourceRoot, '');
    return { manifest, totalBytes: total };
  }

  /** protectArtifacts 核心：封存角色任务临时区（sqlite 一次一致快照 + 会话 JSONL + 工作文件）。 */
  async protectRun(runId, taskRootPath, { simClockMs = null } = {}) {
    if (typeof runId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(runId)) throw failure('INVALID_RUN', 'protectRun 需要真实 runId');
    if (typeof taskRootPath !== 'string' || !taskRootPath) throw failure('INVALID_TASK_ROOT', '宿主未提供任务目录');
    await this.initialize();
    const relDest = join('runs', runId);
    const sealedRel = join(relDest, 'sealed.json');
    if (await exists(join(this.root, sealedRel))) return this.#reseal(runId, taskRootPath, { simClockMs });
    // 已执行角色的目录必须真实存在；丢失不能误称完整。
    const rootStat = await fs.lstat(taskRootPath).catch(e => { if (e.code === 'ENOENT') throw failure('TASK_ROOT_MISSING', '角色任务目录不存在，不能封存为空：' + taskRootPath); throw e; });
    if (!rootStat.isDirectory()) throw failure('TASK_ROOT_MISSING', '角色任务路径不是目录：' + taskRootPath);
    // 1. runtime.sqlite 一次一致快照（同一字节写两处）
    const sqlite = await this.snapshotSqlite(join(taskRootPath, 'runtime.sqlite'), join(relDest, 'runtime.sqlite'));
    // 2. 会话 JSONL、工作区文件等全量复制；sessions 缺失仅在“未执行即取消”时明确记录
    const sessionsPresent = await exists(join(taskRootPath, 'sessions'));
    const tree = await this.copyTree(taskRootPath, join(relDest, 'task-files'), { exclude: new Set(['runtime.sqlite', 'runtime.sqlite-wal', 'runtime.sqlite-shm']) });
    // 3. 全部文件写完后才确认封存标记；manifest 完整列出每文件摘要
    const manifestBody = { runId, archivedAt: new Date().toISOString(), simClockMs,
      sqlite: sqlite.digest ? { path: sqlite.path, digest: sqlite.digest, bytes: sqlite.bytes, snapshot: 'VACUUM INTO 一致快照，同一字节双副本' } : null,
      sessions: sessionsPresent ? 'sealed' : 'absent-in-source',
      files: tree.manifest, totalBytes: tree.totalBytes,
      note: '角色任务临时区完整封存；runtime.sqlite 为 VACUUM INTO 一致快照，会话 JSONL 与任务文件为逐字节复制。' };
    const written = await this.file(sealedRel, manifestBody);
    // 4. 摘要 sidecar 供重试核查（文件内容摘要不能在文件内部）
    await this.file(join(relDest, 'sealed.digest'), written.digest + '\n');
    // 5. 日志记录最后写；任一步失败都不存在“完整封存”
    await this.append('role_run_sealed', { runId, sealed: { path: written.path, digest: written.digest, bytes: written.bytes }, sqliteDigest: sqlite.digest ?? null, fileCount: tree.manifest.length, totalBytes: tree.totalBytes }, { simClockMs });
    return { runId, reused: false, digest: written.digest, sqliteDigest: sqlite.digest ?? null, fileCount: tree.manifest.length };
  }

  /** 重试核查：按 manifest 逐文件核对两份实际字节与摘要；缺失从另一副本补齐，再缺从源补，仍缺抛错。 */
  async #reseal(runId, taskRootPath, { simClockMs }) {
    const relDest = join('runs', runId);
    const manifestBytes = await fs.readFile(join(this.root, relDest, 'sealed.json'));
    const manifest = JSON.parse(manifestBytes);
    const digestText = sha(manifestBytes);
    if (manifest.runId !== runId) throw failure('ARCHIVE_CONFLICT', '封存清单角色身份不一致');
    // Strict file() comparison checks either existing sidecar and also repairs
    // a missing marker/mirror after an interrupted initial seal.
    await this.file(join(relDest, 'sealed.json'), manifestBytes);
    await this.file(join(relDest, 'sealed.digest'), digestText + '\n');
    const entries = [];
    if (manifest.sqlite?.digest) entries.push({ rel: 'runtime.sqlite', digest: manifest.sqlite.digest, sourceRel: 'runtime.sqlite' });
    for (const item of manifest.files ?? []) if (item.digest) entries.push({ rel: join('task-files', item.path), digest: item.digest, sourceRel: item.path });
    let repaired = 0;
    for (const entry of entries) {
      for (const base of [this.root, this.mirror]) {
        const target = join(base, relDest, entry.rel);
        if (await exists(target)) {
          const actual = sha(await fs.readFile(target));
          if (actual !== entry.digest) throw failure('ARCHIVE_CONFLICT', '封存文件字节与清单摘要不一致，不覆盖：' + target);
          continue;
        }
        // 优先从另一归档副本按摘要补齐，其次从任务源目录补齐；都不可得抛错阻断。
        const sibling = join(base === this.root ? this.mirror : this.root, relDest, entry.rel);
        let bytes = null;
        if (await exists(sibling)) { const candidate = await fs.readFile(sibling); if (sha(candidate) === entry.digest) bytes = candidate; }
        if (!bytes) {
          const sourceFile = join(taskRootPath, entry.sourceRel);
          if (await exists(sourceFile)) { const candidate = await fs.readFile(sourceFile); if (sha(candidate) === entry.digest) bytes = candidate; }
        }
        if (!bytes) throw failure('ARCHIVE_INCOMPLETE', '封存文件两份均缺失或摘要不匹配，且源不可补：' + entry.rel);
        await this.#placeBytes(target, bytes, { mode: 0o600 });
        repaired++;
      }
    }
    await this.append('role_run_resealed', { runId, verified: entries.length, repaired, sealedDigest: digestText }, { simClockMs });
    return { runId, reused: true, digest: digestText, verified: entries.length, repaired };
  }
}
