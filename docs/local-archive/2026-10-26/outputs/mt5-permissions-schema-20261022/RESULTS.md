# MT5 permissions 工具 schema 修复 · 2026-10-22

错误：DeepSeek 返回 `400 Invalid schema for function 'mt5_trading_permissions': schema must be JSON Schema type object got type null`。

原因：能力清单中 `mt5_trading_permissions.inputSchema` 只有顶层 `anyOf`，两个分支都是 object，但根没有声明 `type`。宿主 `plugin-system/package.js:94` 与 `plugin-registry.js:627` 将能力 schema 原样传为模型工具 parameters，没有删除 type。缓存安装包 2.1.5 至 2.1.10 都有同一声明；2.1.10 路径为 `%LOCAL_USER_PROFILE% DB，不自行判定哪个缓存版本当前已激活。

最小修复：只在该工具的 inputSchema 增加 `"type": "object"`。原 anyOf、read/enable 的 required、字段类型和 additionalProperties 全部保留。不添加 properties、不放宽输入，不改宿主、模型配置或交易行为。源码版本保持待部署的 2.1.11。

新增独立回归 `plugins/optional-api-v1/tests/mt5-permissions-schema.test.mjs`：

- 根 object 和两条严格操作分支；修复前断言失败。
- 570 组合法/非法输入与原 anyOf 的接受结果一致。
- 实际 `PluginRegistry.register → CapabilityService.resolve → PluginRegistry.definitions` 注册链路，断言真实 descriptor 与 Agent parameters 的根类型为 object，序列化后 anyOf 不变。使用纯内存 store，不初始化 Runtime、不读 DB、不激活 MT5。

新测试及已有两组权限测试共 23 项通过，0 失败、0 跳过。命令（cwd `E:/brief2great/sesame/sesame`）：

```powershell
$env:SESAME_HOST_ROOT = 'E:/brief2great/sesame/mt5agent'
node --import ../mt5agent/modules/plugins/sdk-loader.js --test plugins/optional-api-v1/tests/mt5-permissions-schema.test.mjs plugins/optional-api-v1/tests/mt5-trading-permissions-capability.test.mjs plugins/optional-api-v1/packages/mt5/tests/trading-permissions.test.js
```

另一审查分支还在 pi-ai 0.99.1 的实际 OpenAI Completions 序列化路径截取 DeepSeek payload，确认添加 type 后原样到达 parameters，anyOf 深等保留、strict:false、网络 fetch 为 0。该分支结果由根 Agent 汇总；本文件不声称已经通过实际模型请求。

`verify.mjs` 对比本分支起点，确认 capabilities.json 仅新增一个 type 字段，此前未跟踪的权限测试未改动；同时扫描全部 core/optional Agent 能力根类型，具体计数见 `evidence.json`。`changes.patch` 仅包含这一个 schema 修改与一个新测试，便于准确暂存。本分支未提交、部署，未改全局 lock/inventory，也未改此前 terminal diagnosis 备份。
