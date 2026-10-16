import { requireValue } from '../../store.js';
import { rowSchema } from '../../tools.js';

export function createTools({ runtime, conversationId, store, box, define, string, optional, Type }) {
  return [
    define('report_read', '列出报告或读取指定报告的元数据与数据源。固定 revision；不按名称猜测报告身份。', { report_id: optional('报告 ID'), revision: Type.Optional(Type.Integer({ minimum: 1 })) }, args => args.report_id ? runtime.report(args.report_id, args.revision) : store.list('report')),
    define('report_publish', '发布 Agent 编写的 Research 或 Strategy HTML。Research 绑定 research_register 的 dataset_ids；Strategy 传已完成的真实 backtest_ids，自动绑定热图、参数、权益、统计和成交组件。在 HTML 放置 <section data-report-component="backtest"></section> 决定位置，省略时自动追加。数据只通过 reportData.query 加载，发布后不可变。', {
      title: string('报告标题'), html_path: string('工作区 HTML 文件'), dataset_ids: Type.Optional(Type.Array(string('research_register 返回的 ID'), { maxItems: 20 })), backtest_ids: Type.Optional(Type.Array(string('mt5_backtest 返回的任务 ID'), { minItems: 1, maxItems: 32 })), report_id: optional('更新已有报告'), expected_revision: Type.Optional(Type.Integer({ minimum: 1 })),
    }, async (args, signal) => {
      const html = (await box.file('read', args.html_path, undefined, signal)).toString('utf8');
      const bytes = Buffer.byteLength(html);
      requireValue(bytes <= 512 * 1024, `报告 HTML 为 ${bytes} 字节，超过 512 KiB（524288 字节）上限`, 422, 'report_html_too_large');
      requireValue(html.trim(), '报告 HTML 文件为空，请先写入报告内容', 422, 'report_html_empty');
      // reportKit uses HTML fragments such as <main> + <script>; the browser
      // validator checks the rendered result after this lightweight format check.
      requireValue(/<[a-z][a-z0-9:-]*(?:\s+(?:[^<>"']|"[^"<>]*"|'[^'<>]*')*)?\s*\/?>/i.test(html), '报告文件未包含完整 HTML 标签；支持完整 HTML 文档或 <main> 等 HTML 片段', 422, 'report_html_invalid');
      const sources = (args.dataset_ids ?? []).map(key => {
        const data = store.get('dataset', key);
        requireValue(data.execution_id, '报告数据必须来自已登记的代码结果');
        return { id: data.id, title: data.title, description: data.description, parameters_schema: { type: 'object', properties: {}, additionalProperties: false }, row_schema: rowSchema(data.rows), provenance: data.provenance };
      });
      signal?.throwIfAborted();
      return runtime.publish(conversationId, args, html, sources, signal);
    }),
  ];
}
