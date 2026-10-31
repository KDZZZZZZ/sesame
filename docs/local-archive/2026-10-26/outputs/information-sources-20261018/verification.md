# 本轮信息源修复验证

日期：2026-10-18。仅记录本轮的针对性验证，不代表全仓库、所有供应商参数或模型研究端到端全部通过。

| 范围 | 结果 | 证据/说明 |
| --- | --- | --- |
| 金融研究 | 28/28 通过，0 跳过 | financial-regression-tests.log；包括季度隔离、具体来源状态、FRED 元数据、CFTC、历史时点与敏感字段 |
| 获取与解析 | 7/7 通过，0 跳过 | transport-audit.md；source_ref、长文引用、编码、来源依赖、隐藏 HTML、真实结果入口与旧样本 |
| AKShare/CCXT JavaScript | 52 通过、1 跳过 | market-audit.md；跳过的是另需 opt-in 的 CCXT route-host 检查，真实注册行情能力已独立实测 |
| AKShare Python | 2/2 通过 | Windows cp1252 输出下的中文数据和错误 |
| CCXT Python | 3/3 通过 | 公开行情桥接定向回归 |
| 宿主 Agent/资源 | 50/50 通过 | host-v2-execution、agent-run-interruption、agent、host-v2-resources 四组；包括普通 subagent/工作流成员通过实际 SDK 工具读取公开产物、业务授权不扩大、私有资源拒绝、中文/emoji 分页 |
| 插件静态契约 | 46 个 optional 包验证、独立组装通过 | buildLock 校验及 validated-optional；这不代表 46 个包都已联网测试 |
| 静态检查 | 相关代码语法、包声明 JSON、scoped lint 和 diff check 通过 | plugin-agent-tasks.js 的旧 no-unsafe-finally 警告保留；不改与本轮无关的逻辑 |

本轮更新了 7 个已修改信息插件的开发锁条目。Kurumi 的既有未审查源码变化保持原状、未纳入锁更新；因此未把整个开发锁标为与全部工作区内容一致。宿主的已发布归档锁仍指向原发布，不伪造新归档的摘要、提交或版本号。

以上去除重复复测后为 **142 项通过、1 项 opt-in 未启用而跳过**。宿主最后一次组合命令：`node --test tests/host-v2-execution.test.js tests/agent-run-interruption.test.js tests/agent.test.js tests/host-v2-resources.test.js`，耗时 136.1 秒，50/50 通过。

真实网络证据分见 financial-audit.md、market-audit.md、transport-audit.md、mt5-plugin-audit.md；每份都区分配置缺失、供应商套餐、当前网络限制、测试脚本错误和插件实现错误。

本轮没有执行交易、发布、推送或替换安装版。隔离测试工作区保留证据，未复制用户认证文件。
