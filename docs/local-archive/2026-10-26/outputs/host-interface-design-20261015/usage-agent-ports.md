# Agent 与平台端口：当前插件生产调用覆盖

核对时间：2026-10-15。只读扫描 `E:/brief2great/sesame/sesame/plugins/api-v1/packages` 与 `optional-api-v1/packages` 当前工作树（包含 dev），并补查 `E:/brief2great/sesame/plugins/optional-api-v1/packages`；补充树目前仅空目录/assets，无源文件。这里的“使用”是入口可达生产代码存在调用，**不是线上调用次数/已实际运行证明**。

采用 rg 定位 + TypeScript AST 检查调用节点（252 个非测试/脚本 JS/TS 文件）+ 人工追踪别名和转传。排除了注释、文档、测试、生成模板字符串；已确认 TypeBox 解构调用、MT5 `{host}=this`、`host.configuration` 作为参数转交给部署服务，以及 `host.environment` 展开后传到 native 编译器，未把仅 `typeof` 能力检查当执行调用。

| 命名空间 | 未找到生产调用的方法 | 已使用方法及插件 | 仅包装/检查说明 |
|---|---|---|---|
| `agents` | 无 | submit/inspect/wait/cancel：auto-factor-mining、manual-trading、kurumi-replay；current：以上三者及 factor-evaluator、mt5、qmt、portfolio-execution | 多处有能力检查，但同插件中均有真实调用。 |
| `tasks` | **run** | list/delegate/inspect/finish/stop：orchestration；read：memory、auto-factor-mining、manual-trading、judgment-evolution、kurumi-replay | 前五个仅由 orchestration 的 Agent 工具 handler 包装调用；仍是生产入口，不应判未用。read 被业务流程用于身份/状态与消息关联。 |
| `inference` | 无 | models：strategy-authoring、auto-factor-mining、manual-trading、kurumi-replay；complete：memory、strategy-authoring、kurumi-replay | auto-factor-mining/manual-trading 只用 models，完整 Agent 执行走 agents。kurumi 周报 complete 由生产 service 动态导入并调用，不能当孤立文件。 |
| `tools` | 无 | define/Type/string/optional 广泛通过解构调用；call：auto-factor-mining、manual-trading、portfolio-execution、kurumi-replay；invocation：factor-evaluator、mt5、qmt、portfolio-execution | `tools.Type` 为 Schema 构造器对象，不是单一方法；scaffold.js 生成模板里的文字已排除。 |
| `plugins` | 无 | discover：plugin-manager、manual-trading；load：plugin-manager、auto-factor-mining；read：plugin-manager；inspect：plugin-manager、auto-factor-mining、manual-trading、portfolio-execution；isActive：judgment-evolution、manual-trading、portfolio-execution；manage：plugin-manager | read 仅为 plugin_read 工具包装；manage 除通用包装外还有 catalog test/install/update 流程，不能说只有空壳。 |
| `configuration` | 无 | read/update/open：configuration；exclusive：mt5、qmt；assertIdle：mt5 | 前三者仅供 configuration 的 Agent 工具包装。MT5 转传参数的 assertIdle/exclusive 已计入。 |
| `environment` | executeWorker 有使用；**execution 属性未发现直接业务消费** | executeWorker：akshare、ccxt、qmt、kurumi-replay、mt5；capabilities：workspace、vnpy；pythonPath：backtrader、ccxt、vnpy | execution 是 `'host'` 常量属性，不是未用方法。MT5 展开整个 environment 属于转传，实际下游消费 executeWorker；没有证据表明消费 execution。 |
| `events` | 无 | emit：memory、strategy-authoring、auto-factor-mining、manual-trading、mt5 | 存在实际发布；不是只能检查是否可用。 |
| `lifecycle` | 无 | onBeforeCompact：memory | memory 注册了真实回调并在服务结束释放 disposer。单一消费者不等于不应属于宿主。 |
| `messages` | 无 | read：memory、auto-factor-mining、manual-trading、judgment-evolution、kurumi-replay、mt5 | 被压缩记忆、状态观察、判断复盘、主聊天工作流、配置导入实际读取。 |
| `executions` | 无 | read：data-access、workspace | data-access 导入真实命令产物；workspace 处理失败时取实际执行记录，并非仅包装一个未用端口。 |

## 证据位置

- Agent 五方法与任务/消息读取：[manual-trading/runtime.js:64](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/manual-trading/runtime.js:64)、[submit/wait:239](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/manual-trading/runtime.js:239)；调用来源证明：[factor-evaluator/evaluator.js:14](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/factor-evaluator/evaluator.js:14)。
- tasks 包装器：[orchestration/tools.js:6](E:/brief2great/sesame/sesame/plugins/api-v1/packages/orchestration/tools.js:6)。tasks.run 的未用结论同时核对了源码调用及别名/动态访问，当前未发现 host 路径动态下标调用。
- inference.complete 和 lifecycle 注册：[memory/compaction.js:224](E:/brief2great/sesame/sesame/plugins/api-v1/packages/memory/compaction.js:224)、[compaction.js:259](E:/brief2great/sesame/sesame/plugins/api-v1/packages/memory/compaction.js:259)；kurumi 周报真实生产入口：[service.js:596](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/kurumi-replay/service.js:596)、[weekly-reports.js:141](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/kurumi-replay/weekly-reports.js:141)。
- 插件发现/跨插件调用：[manual-trading/composition.js:31](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/manual-trading/composition.js:31)；仅资源读取包装及管理：[plugin-manager/tools.js:11](E:/brief2great/sesame/sesame/plugins/api-v1/packages/plugin-manager/tools.js:11)；catalog 管理真实流程：[catalog.js:108](E:/brief2great/sesame/sesame/plugins/api-v1/packages/plugin-manager/catalog.js:108)。
- 配置包装：[configuration/tools.js:16](E:/brief2great/sesame/sesame/plugins/api-v1/packages/configuration/tools.js:16)；MT5 自动连接中的解构 host：[auto-connect.js:29](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/auto-connect.js:29)；转传配置后使用：[deployments.js:146](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/deployments.js:146)。
- environment 转传：[dependencies.js:33](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/dependencies.js:33)、[native.js:103](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/native.js:103)。
- 执行记录：[workspace/tools.js:76](E:/brief2great/sesame/sesame/plugins/api-v1/packages/workspace/tools.js:76)、[data-access/research-tools.js:23](E:/brief2great/sesame/sesame/plugins/api-v1/packages/data-access/research-tools.js:23)。

## 对合并与职责的有限判断

1. `tasks.run` 无调用且暴露原始 TaskRun；可优先考虑内部化或与 inspect 的稳定运行摘要统一。不能仅把 `agents.inspect` 和 `tasks.inspect` 改同名就视为合并完成：前者按事件 job ID，后者按 conversation ID，生命周期和所有权不同。
2. agents 和 tasks 的排队、预算、取消、Run 归属、证据读取属于本体通用执行责任，建议共用底层任务模型和审计，但保留“插件事件提交”与“父子委派”两类明确入口。inference 是无工具无会话推理，不宜与完整 Agent 强行合成一个模糊方法。
3. **固定 research/strategy 角色、研究/策略报告空间以及新委派必须选报告目的地，是通用 Agent 接口中混入的产品/研究工作流策略。** 角色与交付协议可由 orchestration/报告插件声明，本体仅负责已声明角色/产物类型的校验、任务调度和资源归属。实际耦合位置：[runtime.delegate:290](E:/brief2great/sesame/mt5agent/modules/agent/runtime.js:290)、[report-output.js:4](E:/brief2great/sesame/mt5agent/modules/agent/report-output.js:4)。
4. `tools.Type/string/optional` 只是 Schema 构建辅助，可作为插件 SDK 导出，减少宿主能力表噪音；但工具注册、分发、Schema 校验和 invocation 真实性必须由宿主保留。
5. 配置并发锁、插件启停和运行资源收尾应留本体；MT5/QMT 连接发现、依赖安装、交易授权、重试与策略编排应在插件，目前上述插件已承担这些业务逻辑。不要因只由一个包装插件调用就把宿主的通用锁/生命周期搬到插件。
