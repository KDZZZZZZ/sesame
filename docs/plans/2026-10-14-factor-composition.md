# 自动因子挖掘：插件组合与评估边界

日期：2026-10-14。状态：先留档，再按根代理确认的独立工具协议实现；已通过便携测试及真实宿主安装/恢复验证。

## 目标

自动因子挖掘负责协作编排、预算、证据账本和最终总结。数据、研究工具、公式实现与数值评估是可组合能力，不能由工作流强制指定品牌、券商或特定挖掘方法。保留已有真实计算和留出集保护，不能把 Agent 手填数字当计算回执。

## 已确认归因

- 本插件没有 MT5、账户、订单或策略挂载调用。不是券商绑定问题。
- runtime.js 直接导入 engine.js；数据、公式校验、开发评价、冗余、最终留出评价都绑定内置 AST。
- team.js 把唯一 AST 算子和字段格式写进所有角色提示；runtime.js 的 tools 固定为 context/submit，使已安装研究能力不能组合。
- report.js 和 scripts/reproduce.mjs 继续依赖固定 AST 指标和内置引擎。
- 模型配置已接受任意已配置 provider/id，配置 digest 检查是复现约束，不是模型品牌限制。
- factor-research 现为 skill + CLI，tool_names=[]、provides={}；计算预先给定的因子列，不是现成 evaluator provider。
- data-access 的 data_read 会导出注册 dataset 的全部 rows；当前原始 dataset 包含开发与 holdout，context 又给出原 sourceId。直接取消工具限制会破坏现有留出隔离。
- 宿主 providers 只开放 market/account 只读提供方，没有 factor evaluator 契约。host.tools.call 要求仍有效的 Agent 工具调用；后台 service host 不能直接跨插件调用。

## 先实施的独立切片

1. 增加显式研究组合输入（拟定 config.research = {plugins:[插件ID], tools:[可选工具名]}，与根代理确认最终命名）。从公开 plugins.inspect/discover 元数据解析，不使用插件身份白名单。
2. 宿主新增的 delegatable_tools 元数据作为主/子 Agent 工具边界依据；plugins 选择全部可委派工具，tools 可进一步指定子集；明确选择 main-only、不存在或停用工具时失败，不猜测名称。
3. 记录选择的插件版本/摘要和解析后的工具集合。创建前校验，恢复时校验，避免悄悄换实现。保留内部 context/submit 交接工具；reporter 仅负责最终归档。
4. 先锁回归：任意命名插件、工具子集、main-only 排除、不可用与歧义失败、摘要变化、现有配置兼容。只使用 fixtures。

## 评估拆分提案与未决边界

最终协议应让工作流保存选中评估实现、输入/候选摘要、计算口径和真实结果回执，避免把 AST/Rank IC 当通用协议。当前 engine.js 及其数值测试必须完整保留，作为明确选择的基线实现。

跨包迁移前向根代理提交确切 API。两个约束不能略过：

- 开放通用 data/workspace 工具后，不能继续称本地注册 dataset 的 holdout 为不可读取；需要独立可信评估方持有不可变留出数据，或明确采用仅开发集的研究模式、最终报告标明未执行 holdout。
- 不新增大范围 provider 体系重构。若走现有工具组合，执行点必须位于有效工具调用，不能使用 service host 冒充主会话；后台编排只消费已验证、已落盘的回执。

不能接受的捷径：只删除 tools 字段；给所有 Agent 暴露完整原数据后仍声称 sealed；接受 Agent 自报收益替代实测；根据插件名自动选 MT5/Qlib；在评估不可用时静默回退另一后端。

## 验证与交付

保留现有 PIT、标签跨段 purge、缺失/常量、成本、版本漂移、重复试验、候选冻结与留出不回流测试。新增通用组合及失败恢复测试；已有实时报告、真实任务观察、单份最终 HTML 行为不变。无真实模型、行情、券商调用；不改根发布锁、不安装发布。

## 已实施决策与证据

- 根代理确认采用独立工具协议而非给内置 AST 改配置名。新增 factor-evaluator 包，移动 engine/数学测试/复现脚本；工作流没有 engine import、AST 校验或数值门槛。evaluator 为必选 {plugin_id,tool,arguments?}，无默认品牌。
- 通用 research 配置解析任意安装插件的 delegatable_tools，支持纯技能插件；agents.submit.plugins 显式加载并冻结所选版本。主会话工具不会被委派。
- prepare 在 start 的真实工具调用中执行；candidate/select 在 submit 内执行；冻结之后用 output:none finalizer 调用 finalize。后台只读取回执，完整 pump 与状态观察均在激活 AsyncResource，真实宿主已验证没有继承已过期调用。
- 通用工具组合只接收 development-only 输入，新评估器拒绝 validationEnd 后行，归档明确没有留出检验。受限运行仍保留候选冻结前不可通过工作流读取留出的边界；不承诺抵抗恶意原生代码。
- 报告对新协议展示任意 JSON 候选与计算回执；保留旧示例的历史显示，只有终结任务写一份总结。旧未选择 evaluator 的活动运行明确拒绝混合续跑，已归档文件身份继续保留。
- 初轮真实 HostContext 测试发现异步 start 让 pump 继承已结束 invocation，已用激活作用域修复；不是关闭宿主校验。
- 2026-10-14：工作流44项、独立评估器21项通过。真实安装器/Store/HostContext/SSE 模型夹具1项通过，覆盖两个完整运行、双方向并发、一次总结、SQLite重开及显式恢复。模型和价格为本地合成夹具，无供应商/券商调用。

## 打包边界修复

官方 buildLock 发现工作流包内 runtime.test.js 直接导入相邻 factor-evaluator，并两次读取其复现脚本；源码树测试可运行，但独立分发不成立。先在外层补两个包的真实 buildLock 回归，再把完整运行时集成测试移至 optional-api-v1/tests，修正模块与资源路径，保留所有断言。包内仅保留自包含单元测试；外层既有运行器自动收集迁移后的测试。更新验证命令与说明，不放宽导入校验，不修改根锁或 profile。

首个导入错误解除后，官方校验进一步发现新 evaluator 缺少清单已声明的 MIT LICENSE 文件；补齐同仓 Sesame contributors 许可文本。运行时及两包单测 67 项通过，官方两个包隔离切片另行验证。
