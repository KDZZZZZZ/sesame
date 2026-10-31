# 验证范围

`tests/engine.test.js` 保留真实算术的固定答案：完美/反向排序、成本、ICIR、非重叠持有期、跨段 purge、留出不影响开发、训练冗余、PIT、时间戳、重复行、不可变副本、缺值、窗口、溢出、缺失远期报价、有界 AST。

`tests/protocol.test.js` 验证真实工具回执、不可变候选与选择、冻结前不能最终评价、调用者绑定、直接 Agent 调用拒绝，以及 development-only 输入不得含留出行。

外层 `plugins/optional-api-v1/tests/auto-factor-mining-runtime.test.mjs` 验证与工作流的真实计算、冻结选择和独立复现脚本；`auto-factor-mining-packages.test.mjs` 用官方 buildLock 验证两个包均无跨包源码导入。实际宿主安装与调用边界由外层 `auto-factor-mining-host.test.mjs` 覆盖：真实 Store/插件安装器/工具循环，仅模型传输和价格为本地合成夹具。设置匹配宿主的 `SESAME_PLUGIN_SDK_LOADER` 后，在 `plugins/optional-api-v1` 运行 `npm test` 会自动收集这些测试。此验证不构成市场有效性结论。
