MT5 的全部官方能力由 sesame/mt5 提供，各工具保留自己的 schema。先读取实际 mt5_catalog 定义，不猜测原生字段。

新策略先用 sesame/strategy-authoring 写 SVL、发布源并由宿主从源生成图，再读取 mt5_target，按目标 profile 翻译原生实现，用 mt5_translation 固定源、文件、source_map、parameter_map 和差异。随后显式调用 mt5_compile、mt5_backtest 或 mt5_deployment。原生编译、真实 Tester、实盘运行与宿主 SVL 回放是各自独立的证据；不得把一层通过写成另一层已验证。FIX 为可选目标能力。

已有独立 MQL5/EX5 工程继续由 mt5_project 管理，保留原语言、修订和轨迹。它们没有 SVL 证明，不能用新的图解释旧运行。主 Agent 可管理配置、查看账本和运行状态；只有用户明确要求交易或运行策略，才执行对应原生动作。插件加载、研究或编译成功本身不构成交易指令。
