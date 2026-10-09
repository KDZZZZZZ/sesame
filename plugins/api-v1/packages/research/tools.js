import { id, digest, requireValue } from './support.js';
import { parseRows, provenance } from './data.js';

export function createTools(host) {
  const { define, Type, string, optional } = host.tools;
  const conversationId = host.scope.conversationId;
  const box = host.workspace;
  return [
    define('data_read', '列出真实输入与已登记结果（包括 MT5 响应快照）。提供 dataset_id 后把完整数据复制为执行目录的 inputs/<id>.json，返回有界样本与来源。大数据用沙箱代码提取字段或统计，勿整文件读回模型；查询新行情使用 MT5 官方工具。', { dataset_id: optional('数据 ID，不填列目录'), directory: optional('执行目录，默认 /work；与 bash.cwd 一致时可分析大型持久工作区中的单个项目') }, async (args, signal) => {
      if (!args.dataset_id) return host.datasets.list({ hydrate: false }).map(({ id, title, row_count, provenance }) => ({ id, title, row_count, provenance }));
      const data = host.datasets.read(args.dataset_id);
      const directory = box.path(args.directory ?? '/work');
      requireValue(!directory.split('/').includes('inputs'), '不能把只读 inputs 作为执行目录');
      const path = `${directory}/inputs/${data.id}.json`;
      await box.file('write', path, JSON.stringify(data.rows), signal, true);
      return { id: data.id, path, rows: data.rows.slice(0, 10), row_count: data.rows.length, provenance: data.provenance };
    }),
    define('research_register', '把本会话成功 bash 执行产生的 JSON 对象数组登记为后端数据。只接受 execution 的冻结输出，不接受手填 rows。', {
      execution_id: string('成功执行 ID'), path: string('该执行输出文件，如 output/result.json'), title: string('结果名称'), description: string('统计口径、单位和局限'), input_ids: Type.Array(string('输入数据 ID'), { minItems: 1, maxItems: 20 }),
      recipe_paths: Type.Optional(Type.Array(string('执行快照中必要的脚本/配置相对路径；动态导入或动态文件名需要显式列出，其他草稿会清理'), { maxItems: 128 })),
    }, args => {
      const execution = host.executions.read(args.execution_id);
      requireValue(execution.conversation_id === conversationId && execution.status === 'completed', '需要本会话成功的代码执行');
      const requested = box.path(args.path), base = execution.workspace_path ?? '/work';
      requireValue(requested.startsWith(`${base}/`), '结果文件必须位于该次执行目录内');
      const path = requested.slice(base.length + 1);
      const encoded = execution.files[path]; requireValue(typeof encoded === 'string', '执行快照中没有该输出');
      for (const recipe of args.recipe_paths ?? []) requireValue(Object.hasOwn(execution.source_files ?? {}, recipe), '复现依赖必须来自该执行的冻结输入');
      const inputs = args.input_ids.map(key => host.datasets.read(key));
      for (const input of inputs) requireValue(execution.code[`inputs/${input.id}.json`] === digest(JSON.stringify(input.rows)), '执行未绑定所声明输入的原始快照；请先 data_read，再执行');
      const text = Buffer.from(encoded, 'base64').toString('utf8'); const rows = parseRows(text); const key = id('data');
      const data = { id: key, title: args.title, description: args.description, rows, execution_id: execution.id, input_ids: inputs.map(x => x.id), ...(args.recipe_paths ? { recipe_paths: args.recipe_paths } : {}),
        provenance: provenance(key, inputs.some(x => x.provenance.source_kind === 'synthetic') ? 'synthetic' : 'derived', 'pi/bwrap', text) };
      host.datasets.register(data); return { dataset_id: key, row_count: rows.length, provenance: data.provenance };
    }),

  ];
}
