MT5 是按需安装的可选后端，要求 Sesame >=0.2.0-0。安装/加载本身不导入旧应用内部集合或原生凭据；用户要求连接或使用 MT5 后，主动发现并复用本机已有配置，由插件保存、导入并验证，无需重复索取这项配置任务的授权。新配置只存本插件私有 storage；固定旧 Artifact 可由宿主读回，不代表旧可变工程集合已迁移。

先用 mt5_dependencies inspect 复用已有 MT5/MCP、Windows Python 和 Wine 配置；真实缺项再读 dependencies skill 并把下载/记录放插件私有目录。本体不内置 MT5 或编译镜像，默认本机编译无需虚拟机。

按 connection skill 先查脱敏设置和待导入引用，用 host_files 检查必要的安装路径与进程；找不到唯一安装不等于未安装。不要打开 Sesame 设置让用户手填。只有本机无法取得有效 MCP 凭据时，才请用户从 MT5「工具 → 选项 → MCP」复制当前连接导出发给 Sesame，随后用 source_message_id 导入、保存并验证。券商登录沿用 MT5 已保存的会话，不索要本插件无法导入的券商密码，不把配置任务当持续交易授权。

MT5 的全部官方能力由 sesame/mt5 提供，各工具保留自己的 schema。先读取实际 mt5_catalog 定义，不猜测原生字段。手动交易先读本插件声明的 TRADING.md，其中定义 MT5 的具体接口、传输前提、订单范围与恢复步骤；通用交易纪律另见 manual-trading skill。

新策略先用 sesame/strategy-authoring 写 SVL、发布源并由宿主从源生成图，再读取 mt5_target，按目标 profile 翻译原生实现，长源码先在当前工作区写单个 JSON 清单（mt5_translation 参数去掉 operation_id，files 内嵌文本），再用 mt5_translation_file(operation_id, manifest_path) 固定源、文件、source_map、parameter_map 和差异，避免工具调用中全文重发。先读 target/translation-file.md；同 ID/路径重试复用首次快照，即使文件已清理；修改内容用新 ID。小内容也可用 mt5_translation 内联登记。随后显式调用 mt5_compile、mt5_backtest 或 mt5_deployment。原生编译、真实 Tester、实盘运行与宿主 SVL 回放是各自独立的证据；不得把一层通过写成另一层已验证。FIX 为可选目标能力。

已有独立 MQL5/EX5 工程继续由 mt5_project 管理，保留原语言、修订和轨迹。它们没有 SVL 证明，不能用新的图解释旧运行。主 Agent 可管理配置、查看账本和运行状态；只有用户明确要求交易或运行策略，才执行对应原生动作。插件加载、研究或编译成功本身不构成交易指令。
