# MT5 交易权限修复：本地提交边界

比较基准为源仓库 HEAD `f19d8220a2d0f17c8bd82d65b55825a17a22a935`，任务开始快照时间 `2026-10-21T05:53:53.790Z`。本目录只保存准备结果；没有修改源代码、源暂存区或创建 commit。

## 推荐独立提交

使用 `core-only.patch`，仅包含本轮新增的两个文件：

- `plugins/optional-api-v1/packages/mt5/backend/trading-permissions.js`
- `plugins/optional-api-v1/packages/mt5/tests/trading-permissions.test.js`

建议提交说明：`feat(mt5): add verified trading permission preparation primitive`。

这次提交只记录可独立的权限准备实现与单元回归，不能描述成完整的插件注册、版本发布或配置界面集成已进入 Git。完整功能已经在当前工作区实现，另外的集成差分见下文。

`head-core-check/` 由上述 HEAD 的 MT5 包导出，再应用 `core-only.patch`，没有复制当前工作区的其他未提交文件。使用匹配宿主的 SDK loader 执行新增权限测试以及 HEAD 原有 `v2-boundary`、`trading-context-read` 测试，结果 **30/30 通过**。详见 `head-core-tests.log` 和 `manifest.json.isolatedHeadTests`。这证明核心两文件不依赖尚未提交的 runtime 拆分或统一配置声明。

实际提交时只选择这两个新文件或此 patch；不要批量暂存整个 MT5 目录。已有暂存内容必须保持原状。

## 完整任务差分

`task-delta.patch` 保存全部 **18 个文件**从任务 baseline 到当前快照的精确字节差分，`patches/` 保存逐文件补丁。已在 `reconstructed-baseline/` 中实际应用完整补丁，并逐文件比对 SHA-256，18/18 与 `after/` 当前快照逐字节相同。12 个包内 baseline 文件均与用户提供的 `baseline.json` 哈希相符。

`task-delta-review.patch` 是统一 LF 后的阅读版本，用来排除换行格式噪声；准确重建以 `task-delta.patch` 为准。`before/`、`after/`、`head-files/` 保留三方原始文件，`manifest.json` 记录每个文件的存在状态和哈希。

这份完整差分是“本轮相对已有工作区的修改”，不是可直接应用到源 HEAD 的提交补丁。

## 本次核心提交不覆盖的集成

- `capabilities.json`：新能力声明、输入协议、副作用与统一配置依赖。HEAD 没有统一 `configuration.fields`；新能力引用的 12 个字段在 HEAD 全部缺失，不能单独增加此能力条目而忽略其已有架构前提。
- `backend/plugin-runtime.js`：本轮只有 `mainOnly` 的一项增加，但该整个文件在任务开始前就已经存在且未被 Git 跟踪；不可作为本轮新文件整体提交。HEAD 的分发仍在 `index.js`。
- `tools/configuration.js`：本轮新增 import 与注册；其已有未提交的配置适配内容不能一起纳入核心提交。
- `plugin.json`、`package.json`：主入口列表和版本 `2.1.0 → 2.1.5`。它们在 baseline 与 HEAD 相同，但不能先提交版本/入口而遗漏完整能力声明、依赖及发行锁的一致性。
- `prompt.md`、`tools/official/prompt.md`、`tools/trading/prompt.md`、`skills/connection/SKILL.md`、`INTERFACES.md`、`TRADING.md`、`README.md`：本轮能力使用说明和状态边界；应与完整入口集成一起提交，避免 HEAD 文档承诺尚不存在的公开能力。
- `plugins/optional-api-v1/tests/mt5-trading-permissions-capability.test.mjs`：本轮新增的公共分发/声明回归依赖完整 capability、配置 fields 和注册，不纳入两文件核心提交。
- `plugins/api-v1/inventory.json`、`plugins/optional-api-v1/official-plugins.lock.json`：结构比较证明本轮仅改变 `packages` 中的 `sesame/mt5` 条目。其完整 MT5 entry 已包含当前工作区其他未提交内容的摘要，不能按当前 entry 整块提交到旧 HEAD。
- `docs/plugin-capabilities-by-responsibility.md`：本轮更新能力计数及 MT5 新条目，但该文档在任务开始前已存在且未被 Git 跟踪，不能作为本轮整份新增。

本次捕获结束时源文件仍与快照一致，源 Git index 的前后 SHA-256 相同。后续若主线程继续修改这些文件，应重新核对快照哈希；本目录不是对未来状态的承诺。
