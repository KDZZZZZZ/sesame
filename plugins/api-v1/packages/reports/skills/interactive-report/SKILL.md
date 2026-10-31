---
name: interactive-report
description: 绑定固定结果，按内容与样式发布报告，检查当前修订并处理修复和导出。
---

# 报告发布与核验

本指南的内容字段属于 sesame/reports。宿主选择其他提供者时遵循其 inputSchema，不套用本插件的组件或便利入口。

先调用 `host.reports.describe` 读取宿主配置的提供者与 inputSchema，再调用 `host.reports.publish({input:{content,style?}, ...})`。宿主选择提供者，Agent 不传 provider。`report_publish({content,style,...})` 仅把旧蛇形外壳字段转接宿主；没有独立发布 HTML 的权限。Report 负责 HTML、主题、图表、公式、数据桥及附录。公开内容接口不接受 `body_html`、`html_path`，不允许上传 HTML、CSS、JavaScript 或 SVG 作为自定义页面。`report_template`、`report_document_template`、`report_backtest_template` 和 `report_compose` 仅供预览或检查结构，不是发布必经步骤；不要编辑其预览 HTML 再上传。

## 固定数据

已有完整 DataRef 直接绑定。裸 `dataset_id` 仅适用于宿主登记数据；插件私有数据通过原 SourceRef 冻结为可追溯成果。未完成或 `available_for_analysis: false` 的数据不能作为证据。

`report_publish.data` 中每项保留实际 `id`、完整 `ref` 和必要描述；内容中的 `data_id` 必须与绑定 ID 一致。`references` 和 `related` 使用真实引用，不伪造某分析插件产出；直接内联已有结果也必须保留来源和时间。来源性质、插件路由和内部审计记录供 Agent 核对，不显示为读者徽章。

来源数据的时区、单位、样本范围、精确字符串、缺失和重复处理保持不变。Report 不取行情、不跑分析、不重新估计统计，不把分页首屏当完整样本。一次图表最多 2,500 行；需要减少数据时使用研究侧登记的聚合或分组结果，并保留原数据引用和口径。

## 内容与样式

- 通用报告用 `content.kind: "document"`，按 [组件契约](../report-design/components.md) 组合 `sections` 和 `appendix`。
- 模块结果用 `content: {kind: "modules", structure, results_ref}`；`structure` 服从用户当前字段选择。`data` 中保留模块结果所需的全部原始固定绑定，不能只附一段 JSON 或替换其 revision。
- 对应回测数据用 `content.kind: "backtest"`，既有研究运行用 `"signal-study"`，选择 `run` 或 `run_source: {ref, entry: "run.json"}` 二选一。run_source 只读已打包固定 JSON，ref 必须在 `references` 或 `data` 声明；不要求 Agent 抄写大型结果，不接受 HTML 来源。布局只读已有结果，不选择分析方法。
- 默认省略 `style`，使用统一蓝灰无框排版；Agent 选择组件以及并排/上下组合。可查询 `report_styles`；仅用户明确要求时以声明式 `custom` 调整受控 token。复用样式用 `report_style_save` 返回的精确版本，示例见 [style-guide.md](../report-design/style-guide.md)。
- 原始数据、参数、来源、样本与完整方法用 `details` 集中到末尾附录；正文只保留判断、主图、短注解、简短推理和关键条件。Report 统一生成往返锚点。
- 公式用 `formula` 的 `latex`、`caption` 和可选 `display`，交给本地 KaTeX 渲染。

## 发布与修订

宿主发布使用真实 title、summary、locale、space、provenanceKind（便利入口为 provenance_kind），以及固定 `data`、`related`、`references`。演示数据明确为 `demo`；用户要求或工作流已绑定的报告位置优先。Research 承载市场、宏观与资料研究，Strategy 承载因子、策略、优化及回测结果；修改报告不迁移其原交易账本或绑定。

`input:{content,style?,assets?,strategy_source?,strategy_evidence?}` 是本插件接受的内容，生成的 HTML 是结果。长内容应将整个 input 保存为 UTF-8 JSON，登记为固定 ArtifactRef 后使用 `inputRef:{ref,entry}`；便利入口为 `input_ref`。不要让 Agent 再抄大段 JSON、反斜杠或公式。input 和 inputRef 严格二选一，引用文件不能只含 content 或整套发布外壳；data/related/references 始终在外壳保留。只需单份报告时不再额外套随机目录。任务必须绑定 report 输出并实际发布；聊天摘要、DataRef、预留文件或源码不替代报告交付。已绑定的路径、报告 ID、原数据引用和观测时点保持稳定。

更新既有报告时使用同一 `artifactId`、当前 `expectedRevision` 和新的 `operationId`（便利入口使用对应蛇形字段），发布新 immutable revision。对同一 operation 的重试保留相同请求，先核对已有结果，不能重复造另一个报告掩盖失败。只修呈现时保留原研究数据、选择、留出结果和绑定证据；修改内容块或样式，不重跑研究。

附件优先使用 `{path,ref,entry,media_type}`，完整 ref 必须也在外壳 references/data/related 中；既有 `{path,source_path,media_type}` 从当前工作区读取，不代表历史时点证明。允许随报告提供的附件是数据、文本或静态位图证据，不是自定义运行时。声明式内容之外的 HTML/CSS/脚本/SVG 上传不会成为发布通道。当前资源预算和 MIME 以能力契约与实际错误为准；不以删证据换取成功。

## 当前修订核验

对 `report_publish` 返回的当前完整 ref 调用 `report_check`，检查本次 receipt。发布成功仅说明内容固定；只有 `receipt.status: "rendered"` 才能说明这一修订完成渲染检查。渲染通过不证明复制过程正确：同时核对保存的完整输入、公式、数字及固定引用与准备稿一致。未检查、超时或失败如实保留，不能引用旧 revision 的通过记录。

按 [report-design](../report-design/SKILL.md) 核对正文阅读、数据与图形一致性、桌面/窄屏、主要交互、公式和附录往返。报错依据具体诊断修正内容或样式，再发布同报告的新 revision 并检查。不要伪造已绑定报告身份或用无关报告替代工作流交付。

## 导出

PDF/PNG 是独立交付。先对同一 ref 使用 `report_export_check`，再检查真正生成的文件；源级 exportability、渲染通过或 `outputVerified: false` 都不证明文件已生成。静态输出仍需包含完整结论、关键条件、来源和需要保留的原始证据，不能依赖悬停、筛选或折叠才能读到它们。

长图和资源限制按实际诊断处理，必要时分片并保留有效交互报告。不要静默删图、删数据或把未完成导出宣称成功。
