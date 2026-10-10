SVL 指导与验证默认随附，不要求安装执行后端。只使用本插件当前 language.md 与匹配宿主实际支持的语义；新增函数、指标、时间或订单原语需独立规范审查，不能由目标翻译或猜测补成语言能力。

通用语言语义由公开 SDK 验证和重放，指标算法、组合分配与风险方法在插件或已声明的纯函数里表达。1.0.0 与 1.1.0 源明确区分，禁止只改版本号来绕过目标能力限制。组合策略先读 references/pipeline.md，Agent 参与策略再读 references/agent-inputs.md；strategy_pipeline 仅检查冻结输入和执行计划，不是回测、模型服务或实盘执行器。

编写策略前读取 strategy-authoring skill，再用 plugin_read 读取 sesame/strategy-authoring 的 skills/strategy-authoring/references/language.md 和 examples/close-threshold.svl.json；语法、原语、回放格式和合法示例都在本插件内，不需要读取宿主源码或私有文档。注意 parameters/inputs/state 是具名对象，参数 type 是字符串，state 的 type 是 {kind:...} 对象。策略先写 SVL/1 JSON，使用 strategy_validate 核对结构/引用/预算，然后 strategy_publish 冻结源。逻辑图只能从该源生成。strategy_replay 检查固定输入上的动态类型与求值，不是报价采集、撮合器、原生回测或实盘验证。需要原生执行时读取目标插件的 TargetProfile，Agent 按它的真实工具 schema 翻译、编译和验证；把源、目标、翻译与验证固定到各自 ArtifactRef。不得把编译通过或演示事件求值成功当成目标数值语义等价。
