# SVL 节点图入口与效果验收边界

本次仅核对当前源码、既有隔离测试及已保存的QA调用与实际UI证据，本切片未操作界面、数据库、账户、模型或业务。16:06Z新增报告内节点交互证据，独立账户SvlView仍记为**设计可达性与覆盖缺口**；不新增产品缺陷编号、不修改候选统计，也不开展修复。

单独发布`strategy.source`后，当前没有独立的节点图预览入口。`SvlView`本身支持不传traces的“仅结构”展示，因此缺少交易轨迹并不是组件不能展示结构图的原因；该组件的实际入口仍依赖账户中的策略卡或成交详情。后续策略报告v2已有另一种报告内图展示，不能把两者合并为同一入口验收。

| 核对项 | 当前源码证据与边界 |
| --- | --- |
| 仅结构展示 | [svl-view.tsx:70](E:/brief2great/sesame/mt5agent/modules/frontend/src/features/strategy-projects/svl-view.tsx:70)将traces声明为可选，默认空数组；第95行明确显示“仅结构”。 |
| 账户策略卡 | [account-strategy-mount.tsx:38](E:/brief2great/sesame/mt5agent/modules/frontend/src/features/canvas/account-strategy-mount.tsx:38)的卡片打开预览，第63行为“查看逻辑”，第70行起的StrategySourceDetail加载source/graph后调用SvlView。第25行起也会为已有活动Run补出卡片；这仍依赖账户已有挂载或运行关联，不是任意已发布source的独立入口。 |
| 选择策略 | [account-strategy-mount.tsx:54](E:/brief2great/sesame/mt5agent/modules/frontend/src/features/canvas/account-strategy-mount.tsx:54)的StrategyOption只有checkbox和onToggle；选择弹窗没有预览动作。不能把打开选择器当作节点图验收，也不应为补视觉证据擅自挂载或启动策略。 |
| 既有成交详情 | [account-trade-cards.tsx:118](E:/brief2great/sesame/mt5agent/modules/frontend/src/features/canvas/account-trade-cards.tsx:118)的“SVL计算过程”依赖成交关联与来源结果，第126行才渲染SvlView。存在此入口不证明本轮新source已由它展示。 |
| 旧策略成果对话框 | [projects-dialog.tsx:17](E:/brief2great/sesame/mt5agent/modules/frontend/src/features/strategy-projects/projects-dialog.tsx:17)只用pre展示JSON，没有节点图。虽然[app-layout.tsx:68](E:/brief2great/sesame/mt5agent/modules/frontend/src/components/layout/app-layout.tsx:68)仍挂载对话框，当前前端没有打开projects的菜单动作；保留组件不等于用户可达入口。 |
| 隔离测试 | [account-strategies-ui.cjs:144](E:/brief2great/sesame/mt5agent/tests/account-strategies-ui.cjs:144)从账户策略卡验证无trace的结构图，后续覆盖成交轨迹、缩放/拖动/键盘、明暗主题和窄屏。该fixture使用受控账户与策略数据，本次未重跑，不能替代当前W1策略的真实UI证据。 |
| 旧菜单测试 | [generic-ui-acceptance.cjs:51](E:/brief2great/sesame/mt5agent/tests/generic-ui-acceptance.cjs:51)通过旧“策略成果与运行”菜单查看JSON；当前菜单已没有该动作，不能将旧测试路径用作当前节点图入口或布局效果的证明。 |

本轮W1的[已保存调用元数据](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-effect-audit.json)记录：

- `strategy_publish`：15:08:40.442Z请求、15:08:41.026Z返回，无outer错误或错误码，返回固定`strategy.source`引用。
- `strategy_graph`：15:09:04.024Z请求、15:09:16.983Z返回，无outer错误或错误码。此条实际发生在15:09，并非15:08。

这两条本身仅支持后端发布与生成图。[W1独立效果审计](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-strategy-effect-audit.md)进一步核对了固定sourceDigest、5节点/2边、114 gold事件和6个control事件提交，以及合计117次扩展函数trace；该审计截至15:52Z，没有操作节点图。之后的报告内交互证据如下，不能倒写成先前已验独立SvlView。

## 16:03–16:06Z 报告内节点图实测

- 策略报告v1的作者代码混传两个sample cohort，report_check明确返回failed；Agent自行按sample分组修成同路径v2，并取得rendered、diagnostics为空的回执。16:03Z[实际v2 UI](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-report-strategy-v2-2026-10-20T16-03-10.432Z.json)确认发布修订/源一致、无pageErrors和全页横溢出。详见[报告检查审计](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/strategy-report-render-audit.md)，不是检查漏报或产品修复。
- [daily-svl-report-graph.json](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-svl-report-graph.json)及[截图](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-svl-report-graph.png)记录真实报告中的5个节点；点击`above: function.call`后“节点定义”展开，继续展开函数后出现`test: compare.gt`。该记录明确scope为报告内图、businessRequests为0。
- 本次已证的是**报告内图的节点展示、点击定义与扩展函数展开**。它不是账户中的独立SvlView，也没有新增该组件的真实缩放/拖动、明暗/窄屏或Netron风格整体布局验收。单独source的独立入口缺口仍在；不能称“全Netron布局已验”，也不能据此断言SvlView渲染失败。

不为补齐覆盖改变账户挂载、运行策略或重做研究。需要独立预览入口仍属于后续设计取舍。
