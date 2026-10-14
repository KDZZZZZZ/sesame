# 验证

本包测试覆盖组合解析、任意命名研究工具/纯技能插件、主会话工具过滤、报告和实时公开状态，所有模块与资源引用均位于本包。外层 `plugins/optional-api-v1/tests/auto-factor-mining-runtime.test.mjs` 保留跨包集成验证：实现摘要漂移、模型配置、真实独立数值回执、非 AST evaluator、角色与代际鉴权、冻结输入、暂停/取消/重启/恢复、预算、最终评估、幂等单份归档、用户文件修改和独立复现脚本。`auto-factor-mining-packages.test.mjs` 把两个包复制到隔离分发目录，执行官方 buildLock，不放宽导入边界校验。

数学验证迁至 factor-evaluator/tests，工作流不再导入数值引擎。外层 `plugins/optional-api-v1/tests/auto-factor-mining-host.test.mjs` 安装两个独立包，在真实 HostContext/Store 上运行双方向研究、最终归档及重启恢复，仅模型与价格为本地夹具。设置匹配宿主的 `SESAME_PLUGIN_SDK_LOADER` 后，在 `plugins/optional-api-v1` 运行 `npm test` 会同时收集包内和外层测试。

带通用研究能力的路径要求 development-only 原数据并在报告明确未执行留出检验。最终评估仅发生于冻结选择之后。所有 Agent output:none；实时视图不写报告文件。

无真实模型、数据或交易调用；这些测试验证协议与实现正确性，不验证因子市场有效性。
