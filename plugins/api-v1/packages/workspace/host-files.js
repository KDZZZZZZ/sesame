
export function createTools(host) {
  const { define, Type } = host.tools;
  const path = Type.String({ minLength: 1, maxLength: 4096, description: '宿主绝对路径；支持 ~/' });
  const page = {
    offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  };
  const encoding = Type.Optional(Type.Union([Type.Literal('utf8'), Type.Literal('base64')]));
  const expected_sha256 = Type.Optional(Type.String({ pattern: '^(sha256:)?[a-f0-9]{64}$', description: '预期完整文件 SHA-256；不要使用分页片段的哈希代替完整文件哈希。' }));
  return [
    define('host_files_list', '只读列出宿主目录中的普通文件和目录；结果有界且可分页，遵循文件端口的应用私有区保护。', { path, ...page }, (args, signal) => host.externalFiles.list(args, signal)),
    define('host_files_search', '在宿主目录中按文件名片段递归搜索；不执行内容，不递归跟随符号链接。', { path, query: Type.String({ minLength: 1, maxLength: 200 }), depth: Type.Optional(Type.Integer({ minimum: 0, maximum: 8 })), ...page }, (args, signal) => host.externalFiles.search(args, signal)),
    define('host_files_read', '只读读取宿主普通文件，每次最多 256 KiB；支持按字节分页，二进制返回 base64。', {
      path, offset: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 262144 })), encoding,
    }, (args, signal) => host.externalFiles.read(args, signal)),
    define('host_files_import', '将不超过 8 MiB 的宿主普通文件复制到当前工作区 inputs，保留原文件并登记来源和哈希。', { path }, (args, signal) => host.externalFiles.import(args, signal)),
    define('host_files_write', '在宿主写入不超过 8 MiB 的普通文件；覆盖需显式 overwrite，可用完整文件哈希防止覆盖已变化的内容。', {
      path, content: Type.String({ maxLength: 12 * 1024 * 1024 }), encoding, overwrite: Type.Optional(Type.Boolean()), expected_sha256,
    }, (args, signal) => host.externalFiles.write(args, signal)),
    define('host_files_mkdir', '在宿主递归创建所需目录，保留已存在目录。', { path }, (args, signal) => host.externalFiles.mkdir(args, signal)),
    define('host_files_move', '在同一文件系统移动一个宿主普通文件到不存在的目标；不覆盖已有目标，跨文件系统需明确复制并核验。', { path, destination: path }, (args, signal) => host.externalFiles.move(args, signal)),
    define('host_files_remove', '删除一个宿主普通文件或空目录；不会递归删除目录树，可用完整文件哈希检查目标。', { path, expected_sha256 }, (args, signal) => host.externalFiles.remove(args, signal)),
    define('host_files_run', '以当前系统用户权限在宿主运行明确的非交互命令，支持已有环境与按需依赖安装。此工具使用真实宿主权限、不自动 sudo；参数逐项传入，输出有界，超时或任务停止会取消子进程。', {
      argv: Type.Array(Type.String({ maxLength: 32768 }), { minItems: 1, maxItems: 256 }), cwd: path,
      timeout: Type.Optional(Type.Integer({ minimum: 1, maximum: 600, description: '秒' })),
      env: Type.Optional(Type.Record(Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]*$' }), Type.String({ maxLength: 32768 }))),
    }, (args, signal) => host.externalFiles.run(args, signal)),
  ];
}
