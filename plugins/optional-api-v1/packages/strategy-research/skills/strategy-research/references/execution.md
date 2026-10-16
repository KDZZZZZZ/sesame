# 可执行资源与精确输入

通过 `plugin_read` 读取 `scripts/experiment.mjs`，原样写入当前任务工作区。使用已配置的
Node.js 22+ 和实际工作区 cwd；没有 `/work` 挂载前提。它只用 Node 标准库，无自动下载。
演示需连同 `examples/*.demo.json` 原样保存；也可在独立已验证包目录只读执行脚本。

```sh
node scripts/experiment.mjs plan plan.json --out plan-check.json
node scripts/experiment.mjs timing plan.json timing.json --out timing-check.json
node scripts/experiment.mjs ledger plan.json trials.json --out ledger-check.json
```

末尾可选 `--out` 创建新文件；相同字节重试可复用，已有不同内容拒绝覆盖。不传则只写 stdout。
记录实际进程 exit code、代码/输出摘要；失败不会输出通过结果。计划 <=256 KiB，其它 JSON
<=16 MiB，样本 <=50,000，试验 <=1,000；严格 UTF-8、准确字段、UTC 毫秒文本。
这不是权限沙箱，使用当前用户文件权限。数据取得与任何源码执行走既有任务管理口。

以 `examples/plan.demo.json` 为完整 schema 示例。字段均必填：

- `data.sha256` 是实际引擎输入导出的字节摘要；`timingSha256` 是独立时间样本导出的摘要。
  `evidence` 记录原始 DataRef/修订/摘要及 as-of 依据。两者不能混用。
- `splits` 精确为 train、validation、holdout，半开区间 `[start,end)`，按时序不重叠。
  `embargoMs` 在下一段开始前留出；保留样本要求 label end 与 label available
  不晚于 `min(current.end,next.start-embargo)`。等于截止允许，决策等于 end 属下一段。
- 每个时间样本包含唯一 id、instrument、decisionAt、featureAvailableAt、labelStart、
  labelEnd、labelAvailableAt。future feature 拒绝；越界标签列为 purged；段外列为 outside，
  都不悄悄当训练数据。该脚本不生成拟合模型，也不是组合净化交叉验证。
- `costs` 是预先声明的 commission/slippage/borrow bps、executionLag 与依据。真实成交模型由
  引擎核验；不得用本脚本代替撮合/费用/涨跌停/停牌/卖空验证。
- `engine` 必须具体 ID/版本和 compatibility。not_checked 或数据 unknown 会输出 blocker，
  不会伪造 engine pass。示例选择 Backtrader 只演示连接形式，不强制实际任务选它。

`trials.json` 是数组；每项结构见固定示例。用 `plan` 输出的 planDigest，实际源码/数据摘要、
参数、`pluginId@version` 和固定结果引用。`result` 只能为 null 或完整 ArtifactRef 对象
`{id,revision,digest,kind,schemaVersion}`；digest 是带前缀 SHA256，schemaVersion 为 `1.0.0`。
completed 必须有 kind=`strategy.result` 的真实引擎结果；失败可用 kind=`resource` 的固定错误证据。
空字符串/泛称“成功”不是结果，unknown 不是完成。CLI 只查格式，宿主还须读取并核对真实 ref。
holdout 记录必须最后且只能一项（失败/未知也视为已暴露）。审计无法阻止另写文件隐藏试验；
需要把计划/选择/账本保存为不可变成果并保留以前所有实验记录。

将输出交给核心 `research_register` 或已有成果接口，再交 reports。不要编造 DataRef；使用真实
工具返回的 ref。资源 CLI 输出自己的结构，不是假冒 `strategy.result` 原生回测收据。
