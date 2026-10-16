import { promises as fs, constants } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { homedir } from 'node:os';

export const digest = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
export const inside = (root, path) => { const rel = relative(root, path); return rel === '' || rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel); };
export const requireValue = (condition, message, status = 400, code = 'INVALID_ARGUMENT') => { if (!condition) throw new ApiError(status, code, message); };
class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const READ_BYTES = 256 * 1024, IMPORT_BYTES = 8 * 1024 * 1024, SCAN_ENTRIES = 10000;
const integer = (value, fallback, min, max, label) => { const result = value ?? fallback; requireValue(Number.isSafeInteger(result) && result >= min && result <= max, label + ' is out of range'); return result; };
const denied = () => new ApiError(403, 'external_file_forbidden', 'Path belongs to application control data, another task, credentials or a system device');

/** Plugin-owned file mechanics; the host supplies immutable path policy, not an old file facade. */
export class FileAccess {
  constructor(context) {
    this.context = context;
    const policy = context.filePolicy;
    requireValue(policy && ['protectedRoots', 'readRoots', 'writeRoots'].every(key => Array.isArray(policy[key]) && policy[key].every(isAbsolute)), 'Host file policy is required');
    this.policy = policy;
  }

  async assertPath(input, { create = false, write = false } = {}) {
    requireValue(typeof input === 'string' && input.length > 0 && input.length <= 4096 && !input.includes('\0'), 'An explicit absolute file path is required');
    const expanded = input === '~' ? homedir() : input.startsWith('~/') ? join(homedir(), input.slice(2)) : input;
    requireValue(isAbsolute(expanded), 'External file operations require an absolute path');
    if (process.platform === 'win32') requireValue(!/^\\\\[?.]\\/.test(expanded) && !expanded.replace(/^[a-z]:/i, '').includes(':'), 'Windows device paths and alternate streams are not allowed');
    const requested = resolve(expanded);
    const protectedPath = async path => {
      const normalized = path.replaceAll('\\', '/').toLowerCase();
      if (/^\/(?:proc|sys|dev)(?:\/|$)/.test(normalized)) return true;
      const canonical = async roots => [...roots.map(root => resolve(root)), ...await Promise.all(roots.map(root => fs.realpath(root).catch(() => resolve(root))))];
      const protectedRoots = await canonical(this.policy.protectedRoots);
      if (write && protectedRoots.some(root => inside(path, root))) return true;
      if (!protectedRoots.some(root => inside(root, path))) return false;
      const allowed = await canonical(write ? this.policy.writeRoots : this.policy.readRoots);
      return !allowed.some(root => inside(root, path));
    };
    if (await protectedPath(requested)) throw denied();
    let path;
    try {
      let ancestor = requested; const suffix = [];
      for (;;) {
        try { path = join(await fs.realpath(ancestor), ...suffix); break; }
        catch (error) {
          if (!create || error.code !== 'ENOENT' || dirname(ancestor) === ancestor) throw error;
          if ((await fs.lstat(ancestor).catch(() => null))?.isSymbolicLink()) throw denied();
          suffix.unshift(basename(ancestor)); ancestor = dirname(ancestor);
        }
      }
    } catch (error) { throw this.fileError(error); }
    if (await protectedPath(path)) throw denied();
    return path;
  }

  fileError(error) {
    if (error instanceof ApiError) return error;
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return new ApiError(404, 'external_file_not_found', '文件或目录不存在');
    if (['EACCES', 'EPERM'].includes(error.code)) return new ApiError(403, 'external_file_unreadable', '当前系统用户无权访问此文件');
    return error;
  }

  async open( input) {
    const path = await this.assertPath( input);
    let handle;
    try {
      const before = await fs.lstat(path);
      requireValue(before.isFile() && before.nlink === 1, '只允许读取普通文件，不支持设备、管道或硬链接', 403, 'external_file_type');
      handle = await fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      const stat = await handle.stat();
      requireValue(stat.isFile() && stat.nlink === 1 && stat.dev === before.dev && stat.ino === before.ino, '文件在读取前发生变化，请重试', 409, 'external_file_changed');
      const checked = await this.assertPath( path);
      const after = await fs.lstat(checked);
      requireValue(checked === path && after.dev === stat.dev && after.ino === stat.ino, '文件路径在读取前发生变化，请重试', 409, 'external_file_changed');
      return { handle, stat, path };
    } catch (error) { await handle?.close(); throw this.fileError(error); }
  }

  async bytes( input, { offset = 0, limit = READ_BYTES, whole = false, signal } = {}) {
    signal?.throwIfAborted();
    const { handle, stat, path } = await this.open( input);
    try {
      requireValue(!whole || stat.size <= IMPORT_BYTES, '导入文件超过 8 MiB，请先选取必要数据', 413, 'external_file_too_large');
      const start = integer(offset, 0, 0, Number.MAX_SAFE_INTEGER, 'offset');
      requireValue(start <= stat.size, 'offset 超出文件大小');
      const length = whole ? stat.size : Math.min(integer(limit, READ_BYTES, 1, READ_BYTES, 'limit'), stat.size - start);
      const buffer = Buffer.alloc(length);
      let read = 0;
      while (read < length) {
        signal?.throwIfAborted();
        const result = await handle.read(buffer, read, length - read, start + read);
        if (!result.bytesRead) break;
        read += result.bytesRead;
      }
      const after = await handle.stat();
      requireValue(after.size === stat.size && after.mtimeMs === stat.mtimeMs && after.ctimeMs === stat.ctimeMs && after.nlink === 1 && read === length, '文件在读取期间发生变化，请重试', 409, 'external_file_changed');
      return { path, bytes: buffer, size: stat.size, offset: start, modified_at: stat.mtime.toISOString() };
    } finally { await handle.close(); }
  }

  async read( args, signal) {
    requireValue(args.encoding === undefined || ['utf8', 'base64'].includes(args.encoding), 'encoding 必须是 utf8 或 base64');
    const result = await this.bytes( args.path, { offset: args.offset, limit: args.limit, signal });
    let encoding = args.encoding ?? 'utf8', content;
    if (encoding === 'utf8') {
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(result.bytes); }
      catch { encoding = 'base64'; }
      if (content?.includes('\0')) encoding = 'base64';
    }
    if (encoding === 'base64') content = result.bytes.toString('base64');
    const { bytes, ...metadata } = result;
    return { ...metadata, encoding, content, bytes_returned: bytes.length, chunk_sha256: digest(bytes), next_offset: result.offset + bytes.length < result.size ? result.offset + bytes.length : null, read_only: true };
  }

  async list( args, signal) {
    const path = await this.assertPath( args.path);
    const offset = integer(args.offset, 0, 0, SCAN_ENTRIES, 'offset');
    const limit = integer(args.limit, 100, 1, 200, 'limit');
    let directory;
    try { directory = await fs.opendir(path); } catch (error) { throw this.fileError(error); }
    const entries = []; let visited = 0, truncated = false;
    for await (const entry of directory) {
      signal?.throwIfAborted();
      if (++visited > SCAN_ENTRIES) { truncated = true; break; }
      const target = join(path, entry.name);
      try {
        const checked = await this.assertPath( target);
        const stat = await fs.stat(checked);
        if (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1)) continue;
        entries.push({ name: entry.name, path: target, type: stat.isDirectory() ? 'directory' : 'file', size: stat.isFile() ? stat.size : null, modified_at: stat.mtime.toISOString(), symlink: entry.isSymbolicLink() });
      } catch (error) { if (![403, 404].includes(error.status)) throw error; }
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return { path, items: entries.slice(offset, offset + limit), next_offset: offset + limit < entries.length ? offset + limit : null, scanned: visited, scan_truncated: truncated, read_only: true };
  }

  async search( args, signal) {
    requireValue(typeof args.query === 'string' && args.query.length >= 1 && args.query.length <= 200, 'query 需要 1–200 字符的文件名片段');
    const path = await this.assertPath( args.path);
    const depth = integer(args.depth, 3, 0, 8, 'depth');
    const offset = integer(args.offset, 0, 0, SCAN_ENTRIES, 'offset');
    const limit = integer(args.limit, 100, 1, 200, 'limit');
    const queue = [{ path, depth: 0 }], items = [], needle = args.query.toLocaleLowerCase();
    let visited = 0, truncated = false;
    while (queue.length && !truncated) {
      signal?.throwIfAborted();
      const current = queue.shift();
      let directory;
      try { directory = await fs.opendir(current.path); } catch (error) { if (current.path === path) throw this.fileError(error); continue; }
      for await (const entry of directory) {
        signal?.throwIfAborted();
        if (++visited > SCAN_ENTRIES) { truncated = true; break; }
        // Do not follow links during recursive traversal; explicit read/list still resolves safe links.
        if (entry.isSymbolicLink()) continue;
        const target = join(current.path, entry.name);
        try {
          const checked = await this.assertPath( target);
          const stat = await fs.stat(checked);
          if (stat.isDirectory()) { if (current.depth < depth) queue.push({ path: checked, depth: current.depth + 1 }); continue; }
          if (stat.isFile() && stat.nlink === 1 && relative(path, target).toLocaleLowerCase().includes(needle)) items.push({ path: target, size: stat.size, modified_at: stat.mtime.toISOString() });
        } catch (error) { if (![403, 404].includes(error.status)) throw error; }
      }
    }
    items.sort((a, b) => a.path.localeCompare(b.path));
    return { path, query: args.query, items: items.slice(offset, offset + limit), next_offset: offset + limit < items.length ? offset + limit : null, scanned: visited, scan_truncated: truncated, read_only: true };
  }

  async write(args,signal) {
    signal?.throwIfAborted();requireValue(typeof args.content==='string'&&['utf8','base64'].includes(args.encoding??'utf8'),'content/encoding 无效');
    if(args.encoding==='base64')requireValue(/^(?:[a-zA-Z0-9+/]{4})*(?:[a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=)?$/.test(args.content),'base64 无效');
    const bytes=Buffer.from(args.content,args.encoding??'utf8');requireValue(bytes.length<=IMPORT_BYTES,'写入超过 8 MiB',413,'external_file_too_large');
    const path=await this.assertPath(args.path,{create:true,write:true});const exists=await fs.lstat(path).catch(e=>{if(e.code==='ENOENT')return null;throw e});
    requireValue(!exists||(exists.isFile()&&exists.nlink===1),'目标必须是普通文件');requireValue(!exists||args.overwrite===true,'目标已存在，需明确 overwrite',409,'external_file_exists');
    if(args.expected_sha256){requireValue(exists,'没有可匹配的现有文件',409,'external_file_changed');await this.expected(path,args.expected_sha256,signal);}
    const temporary=join(dirname(path),'.sesame-write-'+randomUUID());
    try{await fs.writeFile(temporary,bytes,{flag:'wx',mode:exists?exists.mode&0o777:0o600});signal?.throwIfAborted();if(args.expected_sha256)await this.expected(path,args.expected_sha256,signal);if(exists)await fs.rename(temporary,path);else{await fs.link(temporary,path);await fs.unlink(temporary);}return{path,size:bytes.length,sha256:digest(bytes),execution:'host'};}finally{await fs.unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e});}
  }
  async expected(path,hash,signal){requireValue(typeof hash==='string'&&/^(?:sha256:)?[a-f0-9]{64}$/i.test(hash),'expected_sha256 无效');const bytes=await this.bytes(path,{whole:true,signal});requireValue(digest(bytes.bytes).toLowerCase()==='sha256:'+hash.replace(/^sha256:/i,'').toLowerCase(),'文件摘要已变化',409,'external_file_changed');}
  async mkdir(args,signal){signal?.throwIfAborted();const path=await this.assertPath(args.path,{create:true,write:true});await fs.mkdir(path,{recursive:true});return{path,execution:'host'};}
  async move(args,signal){signal?.throwIfAborted();const path=await this.assertPath(args.path,{write:true}),destination=await this.assertPath(args.destination,{create:true,write:true}),stat=await fs.lstat(path);requireValue(stat.isFile()&&stat.nlink===1,'move 只支持普通文件');await fs.link(path,destination).catch(e=>{if(e.code==='EEXIST')throw new ApiError(409,'external_file_exists','目标已存在，未覆盖');throw e});try{signal?.throwIfAborted();await fs.unlink(path)}catch(e){await fs.unlink(destination);throw e}return{path,destination,execution:'host'};}
  async remove(args,signal){signal?.throwIfAborted();const path=await this.assertPath(args.path,{write:true}),stat=await fs.lstat(path);requireValue((stat.isFile()&&stat.nlink===1)||stat.isDirectory(),'remove 只支持普通文件/空目录');if(args.expected_sha256){requireValue(stat.isFile(),'目录不支持文件摘要');await this.expected(path,args.expected_sha256,signal);}signal?.throwIfAborted();if(stat.isDirectory())await fs.rmdir(path);else await fs.unlink(path);return{path,removed:true,execution:'host'};}
}
