# CLI 与数据合同

用 `plugin_read` 读取 `scripts/factor.mjs` 原样写入任务目录，再使用已有 Node.js 22+ 执行。
不依赖 npm 包，无安装/联网或任意公式执行。所有相对路径按真实 cwd，输出由 `--out NEW_JSON`
指定（相同字节可重试，不覆盖不同结果）；不指定则 stdout。非零退出是失败。

完整计划/行见 `examples/plan.demo.json`、`examples/development.demo.json`、
`examples/holdout.demo.json`。脚本示例命令在 README。资源路径均相对本插件根。

计划必须记录两个文件的 SHA256 **原始字节**（`sha256:` 前缀）、provenance、PIT universe、
调整模式、退市处理、availability 与真实来源 evidence。unknown 不被改成 known；结果
`inputQuality: limited` 不能作历史可交易性证据。metadata 的 declared_only 也不是外部核验。
固定 1–16 个 `factors`（id、direction ±1、definition），不执行 definition 文本。
三个半开时序区间 train/validation/holdout、embargoMs、最多 1000 次的总预算与选择标准均在
看结果前固定。计划 <=256 KiB；每个数据/结果文件 <=16 MiB、最多 50,000 行。

每行格式严格为：

```json
{
  "instrument":"真实来源标的身份",
  "decisionAt":"2024-01-01T09:30:00.000Z",
  "universeKnownAt":"2024-01-01T08:00:00.000Z",
  "eligible":true,
  "features":{"chosen_factor":{"value":"0.12","availableAt":"2024-01-01T09:00:00.000Z"}},
  "label":{"start":"2024-01-01T09:31:00.000Z","end":"2024-01-01T16:00:00.000Z","availableAt":"2024-01-01T16:01:00.000Z","return":"0.003","status":"observed"}
}
```

所有 `features` 键必须与计划吻合。缺因子使用 value/availableAt 均 null，按因子报告覆盖率，
不填零。eligible 是当时成员，不能按以后退市状态筛掉。label 是简单总收益比例，范围 [-1,100]，
明确 observed / delisting_included / unavailable。eligible 的缺收益拒绝；ineligible 行可保留
unavailable，但它不会进入统计。所有价格/因子原值是十进制文本；只有诊断计算转 binary64。

时间必须 canonical UTC 毫秒文本，日历无效/无时区/墙钟拒绝。特征和成分可得时间 <=决策；
标签 start >=决策、end>start、availableAt>=end。同一决策的截面标签窗口必须一致，持有窗口
不能互相重叠。跨段 label end/available 或 embargo 被明确列为 purged，不默默进入拟合。

`screen` 只接 development 文件，出现任何 holdout/段外行即拒绝，train/validation 各至少两个
保留时点。它返回所有候选及失败/缺失，训练段相关性，**不自动选最优**。
`select PLAN SCREEN FACTOR_ID` 明确选择且绑定当前脚本、计划、开发结果和留出文件摘要；
常量/有效期不足的候选拒绝。`holdout PLAN HOLDOUT SCREEN SELECTION` 比较整个冻结选择，
只算选定因子。更换计划/方向/输入/代码后旧选择失效。

## 使用现有宿主工具固定选择

`select` 写出的 JSON 对象仍是可写文件。先固定它，再用 `data_read` 导出留出数据，不把
本地 `--out` 等同不可变发布。使用现有工具即可，无需另一个研究服务：

1. 开发数据已由 `data_read` 导出，计划记录该导出文件的实际字节摘要；数据重排或缩进也会
   改变摘要，不能把同义 JSON 的其它序列化摘要代入。留出摘要由数据准备步骤固定，不通过
   筛选脚本预读留出内容来生成。
2. 把下面脚本保存为 `seal-selection.mjs`，在实际工作区用 `bash` 执行 Node.js，保留成功的
   `execution_id`；脚本只将现有选择包装成登记工具要求的对象数组：

   ```js
   import fs from 'node:fs';
   const selection = JSON.parse(fs.readFileSync('selection.json', 'utf8'));
   fs.mkdirSync('output', { recursive: true });
   fs.writeFileSync('output/selection.rows.json', JSON.stringify([selection]));
   ```

3. `research_register` 使用该真实执行 ID、`path:"output/selection.rows.json"`、开发数据的
   `input_ids`，并在 `recipe_paths` 保留 `factor.mjs`、`plan.json`、`screen.json`、
   `selection.json`、`seal-selection.mjs`。然后对返回的 dataset_id 调 `report_data`，
   `operation_id` 标识这一次选择；已有开发 DataRef 放 `dependencies`。记录返回的完整
   ref 和选择内容摘要，demo 仍为 demo。
4. 确认本地选择与固定成果一致，才导出留出文件并执行 `holdout`。将本次暴露写入试验账本；
   最终曲线登记后用 `report_data` 引用这个固定选择与留出输入。修改选择需新实验及新的
   未使用留出样本，不能覆盖原成果、换操作 ID 后称为首次评估。

这是一种可复查的本地文件协议，不是不可篡改账户账本。发布到宿主不可变成果后再打开留出，
记录每次暴露与既往试验；若在其它程序看过数据，必须声明，不能用 hash 来洗成 untouched。
