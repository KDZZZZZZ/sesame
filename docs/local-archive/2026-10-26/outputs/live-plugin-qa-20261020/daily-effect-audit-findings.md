# daily-integrated 首段观察

最后一次补充快照为 2026-10-20 14:58:14.181 UTC：W1、W3 已中断，W2 已真实运行；没有任何分支可据此记为设计效果通过。持续观察在 14:55:47 已停止，之后只按根助手要求补了一次快照，没有留下后台轮询。访问仅限主 WAL 的白名单元数据和本轮 JSONL，无子 SQLite、无模型或业务请求。

末次状态：

- W1 `run_5720ad84-71c0-419a-91ba-bc3639d41ef6` 在 14:55:48.957 interrupted / `ENOENT`；`backtrader_environment` 的 `run_e81bba77-ce2b-4586-8c46-28d8f0849b16`、其 `host.process.exec` `run_2bfa2030-41e5-42a4-a62d-88fb336e401c`，以及 `vnpy_environment` 的 `run_0ca43533-408f-4c3f-8059-2e29750bcd87` 均为同类 `ENOENT`。两工具都尝试启动 `<workspace>/plugins/data/sesame/backtrader/backtrader-1.9.78.123/Scripts/python.exe`；只读文件存在性检查为 false。这证明当时指定可执行文件不存在，不证明 Windows 拼路径代码有错。主会话随后 `run_2ddfe0a2-0378-4820-be3d-3961631d8dcf` 则实际退出 1，短错误明确为 `ModuleNotFoundError: No module named 'backtrader'`。没有真实引擎结果；不再次代其修复或重试依赖。
- W3 `run_598001e6-f656-4ef1-bd4f-c4b882bea772` 的 job 已 interrupted；其 `host.process.exec` `run_d78646c0-8e35-44bf-b1c8-09df1fb097db` 在 14:56:47.810 interrupted / `PROCESS_EXIT`，稍后主 WAL 状态为 unknown。实际是 powershell.exe 中执行 Agent 自建 `verify-web.mjs:4:347`，Node 抛出 `AssertionError [ERR_ASSERTION]`，退出 1。同批后续 write/read 连带报错，不分别算独立产品缺陷。
- W2 `run_430e50f3-b6f7-47e6-9ce9-e70382f08b3b` 于 14:57:10.262 创建，session `conv_96acb5f0-3eb0-444f-83fd-7eb6a8837cc8`，job running。以下较早窗口记录保留时间标记，不覆盖为新的“已完成”结论。

W3 断言的归因已经收敛：Agent 脚本把 `data_read` 行里的已解码 HTML 再编码为 UTF-8，要求其哈希等于原始字节的 `source_provenance.data_hash`。两个来源的解码文本都比原始字节恰少 UTF-8 BOM 的 3 字节。纯文件哈希核验表明，在这两个解码文本前加 `EF BB BF` 后，分别精确得到原 provenance 的 `aec7505c…` 与 `d75c3af8…`；原始/规范文本不是同一字节序列。代码证据为 `web-sources/index.js:18` 对原始 bytes 计算 hash，`web-extract/parser.js:64` 和 `web-sources/fetch.js:24` 通过 TextDecoder 解码。属于 Agent 验收脚本的错误等价假设，不能记为获取/提取插件数据损坏；应验证原始 raw entry 的 hash，单独记录规范文本 hash。本观察没有修改脚本、执行它、替 Agent 生成报告或发起新提取。

上述精确进程错误和两个 BOM 核验结果保存在 `daily-effect-audit-process-errors.json`。15:01 起根助手另行启动动态 observer；本代理不再改写它的动态 JSON/MD。

## 委派阻碍与自行恢复

| 分支 | 首次拒绝 | 精确原因 | 当前事实 |
| --- | --- | --- | --- |
| W1 策略 | `run_7be9a707-a11f-46c5-938f-53fd509775ba`，14:47:20.313 interrupted | `allowedCalls` 授予 `sesame/mt5#mt5_dependencies`；该工具在 MT5 `main_tool_names` | 主 Agent 自行取消，14:53:40.815 cancelled；随后新 Run 已真实执行 |
| W2 团队 | `run_bd76b264-7990-4663-ac04-bab5a68e080d`，14:48:39.701 interrupted | `allowedCalls` 授予 `sesame/qmt#qmt_environment`；该工具在 QMT `main_tool_names` | 主 Agent 自行取消，14:53:42.739 cancelled；窗口末尚无真实 W2 job |
| W3 工作区/来源 | 无这类拒绝 | 其委派名单未包含上述主会话专用工具 | 持续执行中，结果待验 |

两条最初错误均为 `CAPABILITY_FORBIDDEN`，消息精确为 `This capability is declared for the main Agent`。拒绝在 `mt5agent/modules/plugins/capability-service.js:85`；`agentTools()` 在第 95 行把委派目标按 subagent 作用域解析，由 `modules/plugins/host-v2/execution.js:72` 调用。这是主 Agent 选择不合法委派能力后被现有权限正确拒绝，不是权限丢失或 schema 变更。无必要放宽权限。

两次拒绝发生在 `tasks.submit` 之前。期间存在 reserved session / `task_run`，但没有 `plugin_agent_task`，不能将其计为已经执行的子模型。14:55:06 主 WAL 核对：

- W1 预留 `conv_4c7ccf4d-8b36-428c-8f14-43b090536113` / `run_c83c9d14-888e-4afc-944f-432c6c9957a6`：conversation canceled、active response null、pending 0；task canceled / cleaned / finish_requested 1。
- W2 预留 `conv_53c869ba-911a-4f24-a066-5bde9f0a7e32` / `run_c2431e80-6185-4300-ae78-d350e2dc327d`：同上。
- 两者当前均已正常清理，没有证据表明形成永久 running 幽灵任务。提交前的 9 条 interrupted 仍为 9；本轮曾新增两条 interrupted，之后已取消。

完整脱敏委派名单和当前实体状态见 `daily-effect-audit-delegation.json`。拒绝原因也已在即时交接消息中记录；当前 Run 的 error 已随正常 cancel 改为 `run_cancelled`。

## 正在执行的真实任务

| 分支 | Run | Session | 已观察到的效果与缺口 |
| --- | --- | --- | --- |
| W1 | `run_5720ad84-71c0-419a-91ba-bc3639d41ef6`，14:55:24.067 创建 | `conv_84154dc1-746a-41fc-b511-f8999507c50f` | 已创建真实 job，并发出 8 个初始工具请求；窗口结束尚未收到返回。受控因子链、引擎结果、SVL 一致性、最终报告均待验 |
| W2 | 尚无成功创建的真实 job | — | 第一条被权限拒绝后已清理，团队回执、execute:false 与判断/记忆效果尚无本轮完成证据 |
| W3 | `run_598001e6-f656-4ef1-bd4f-c4b882bea772`，14:49:49.928 创建 | `conv_3e7644fd-9a6a-4b7c-b2c9-ff4c5b3d1f90` | 53 次工具请求、49 次返回；已开始真实文件操作、两次固定来源提取、AKShare 环境/目录读取。临时插件完整生命周期、行情冻结及报告交付待验 |

W3 的两次 `extract_webpage` 都只使用原来两个冻结 SourceRef；这是正确的来源复用，不是重新抓网页。实际返回：

| 固定来源 | 文本字符数 | 文本 SHA256 | 返回 links 数 / link_count 字段 |
| --- | --- | --- | --- |
| `artifact_5e97ec16-5f46-42f4-b14b-91cbe874fdee` | 2224 | `712d43710ed884a23fcabc0f2d72aa9e75e3a7ce177e811bfc0b64bf94e803a3` | 34 / 36 |
| `artifact_cfa19752-3f46-46b3-b6c0-0ecabacbdc75` | 3554 | `2394f668b9529135887fe454770d770b94ef7bdd91c29f4ca473896362413bb1` | 26 / 29 |

这些数值是工具原始字段，不把 `link_count` 与去重后链接数组长度自动解释成同一指标，也不据此宣告 bug。尚需检查 Agent 保存的完整提取结果、首尾段、政策核心内容、导航残留及下游引用；当前只证明返回了对应来源的正文和链接结果。AKShare 只有 status/catalog 的正常返回，尚不能当成读取原生行情成功。

## 效率事实

- 用户消息 14:42:52.742 → 首次委派 14:47:19.772：267.030 秒，共 38 次准备调用。包括 9 次 `plugin_load`、5 次能力目录、5 次文件目录、4 次插件发现。它们并非全部相同输入，不能一律称重复无效。
- 第一次 W1 委派到正确 W1 Run 创建经过 484.295 秒。该时段同时处理 W3 和其他前置操作，不全部归因为单个错误的修复时间。
- 截止窗口末主会话共 69 调用、16 个工具批次、443,518 字节工具返回、1 条压缩记录；W3 为 53 调用、9 批、347,199 字节已返回内容；W1 为 8 请求、1 批。
- 精确相同输入重复仅发现一组主会话 `host_capabilities_list`，共 2 次；未发现相同参数三连失败。W3 一条 `plugin_read` 返回 52,277 字节，其必要性需结合后续临时插件实现判断，当前不直接归为浪费。
- 主会话的 `report_read`、`mt5_trading_context`、`data_query` 各有一次失败；本取证器只分类为错误候选，未拿这些错误代替根因调查或认定产品问题。
- 未观察到本轮完成通知被动唤醒链，也没有设计效果通过结论。主会话仍 working。

最小建议是主会话按已公开的 delegatable_tools 筛选子任务白名单，主会话完成 main-only 环境检查后只传必要结果；不修改权限，也不再重复派发原三个完整任务。剩余效果在真实任务完成后核对冻结产物和报告即可。

## 复跑

`node outputs/live-plugin-qa-20261020/daily-effect-audit.mjs` 为单次增量合并快照；加 `--watch --minutes 10` 最多观察 10 分钟，每 15 秒采样。输出仅工具 ID、名称、状态、用量、输入摘要、结果长度/摘要及白名单指标；不保存完整输入、结果正文、思考、密钥或账户标识。

`node outputs/live-plugin-qa-20261020/daily-effect-audit-delegation.mjs` 单次核对本轮委派名单和主 WAL 预留状态。两个脚本均已 `node --check` 并做过真实只读验证；不运行 Store、Runtime 或管理 API。
