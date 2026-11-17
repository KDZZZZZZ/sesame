# 读取输入与登记执行证据

## 数据身份与完整文件

| 调用 | 实际行为 |
| --- | --- |
| data_read({cursor?,limit?}) | 列出宿主登记数据，返回 `{items,nextCursor?}`；不是所有插件私有数据集或所有成果目录。 |
| data_read({datasetId,directory?}) | 读取宿主登记输入全部行，写入执行目录 inputs。 |
| data_read({ref,directory?}) | 读取完整固定 DataRef 的全部行并写入执行目录 inputs；ref.kind 必须是 data。 |

读取时 datasetId/ref 二选一；固定 DataRef 保留 id、revision、digest、kind、schemaVersion 全部字段。插件私有 datasetId 先经所属来源查询或快照，不能直接当成宿主登记 ID。返回 `{datasetId或ref,path,rowCount,sample,provenance}`，用实际 path 读完整数据，不从有界 sample 推断全文。

directory 默认当前工作区，任何路径段都不能叫 inputs；宿主把 JSON 放入该目录的 inputs 下。最多 100000 行、8 MiB JSON 数据；采集的 16 MiB 预算不等于计算导入预算。超限时按任务划分真实输入并保留各自引用，不静默截断数据。

### 读取登记输入：data_read

```json
{
  "datasetId": "<宿主登记数据ID>",
  "directory": "analysis"
}
```

## 同一执行目录

例如输入写入 analysis/inputs，配方写入 analysis/calculate.mjs，workspace bash 使用 `{command:"node calculate.mjs",cwd:"analysis"}`。脚本从工具返回的真实路径读取数据，将结果写入 analysis/result.json。这是目录与证据关系示例，不要求特定语言或固定目录名。

bash 返回实际 executionId、进程 Run 与执行回执；research_register 取 executionId。cwd 必须覆盖实际 inputs 和配方，才能进入同次冻结快照。进程权限与当前系统用户一致，不假设 /work 是挂载目录。

## 登记计算

research_register 必需 operationId、executionId、path、title、description，并在 inputIds（宿主登记输入）或 inputRefs（完整固定 DataRef）至少一种中提供实际输入；可附 recipePaths。

path 相对该次 execution.workspace_path，也可使用该目录内的真实绝对路径；recipePaths 是执行目录内的配方相对路径。该会话的成功执行必须冻结输出与精确输入哈希，所列配方也必须在冻结输入中。输出须为 JSON 对象数组，不允许 NaN/Infinity；单位、缺失值、筛选、分母和时间口径应由脚本明确处理。

### 登记计算：research_register

下例承接前面的登记输入。替换实际 executionId 和相同 datasetId；不要使用 Run ID、当前可变文件或手填状态代替执行记录。

```json
{
  "operationId": "research-result-001",
  "executionId": "<本会话成功计算返回的executionId>",
  "path": "result.json",
  "title": "研究计算结果",
  "description": "记录本次计算实际使用的单位、时间范围和统计口径。",
  "inputIds": ["<宿主登记数据ID>"],
  "recipePaths": ["calculate.mjs"]
}
```

返回固定计算 DataRef、evidence、实际行列摘要及 provenance，可交给报告或其他能力。输入为 demo 时派生结果仍保留 demo。稳定 operationId 仅重试同一请求，变更输入或计算需新执行与新 ID。

snapshotErrors 指向文件过多、过大或不安全链接等快照问题时，将必要输入、脚本和输出集中到独立目录后重算；缩短工具预览不能补齐冻结文件。执行成功不自动证明统计结论、SVL 固定事件回放或原生回测效果，仍按任务验收相应证据。
