import { externalFiles } from '../../external-files-service.js';

export function createTools({ runtime, conversationId, box, define, Type }) {
  const path = Type.String({ minLength: 1, maxLength: 4096, description: '宿主绝对路径；支持 ~/' });
  const page = {
    offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  };
  return [
    define('host_files_list', '只读列出宿主目录中的普通文件和目录，过滤私有数据；结果有界且可分页。', { path, ...page }, (args, signal) => externalFiles(runtime).list(conversationId, args, signal)),
    define('host_files_search', '在宿主目录中按文件名片段递归搜索；不执行内容，不递归跟随符号链接。', { path, query: Type.String({ minLength: 1, maxLength: 200 }), depth: Type.Optional(Type.Integer({ minimum: 0, maximum: 8 })), ...page }, (args, signal) => externalFiles(runtime).search(conversationId, args, signal)),
    define('host_files_read', '只读读取宿主普通文件，每次最多 256 KiB；支持按字节分页，二进制返回 base64。', {
      path, offset: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 262144 })), encoding: Type.Optional(Type.Union([Type.Literal('utf8'), Type.Literal('base64')])),
    }, (args, signal) => externalFiles(runtime).read(conversationId, args, signal)),
    define('host_files_import', '将不超过 8 MiB 的宿主普通文件复制到当前 /work/inputs，保留原文件并登记来源和哈希。', { path }, (args, signal) => externalFiles(runtime).import(conversationId, args, box, signal)),
  ];
}
