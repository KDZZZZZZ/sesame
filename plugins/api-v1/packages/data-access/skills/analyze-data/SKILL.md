---
name: analyze-data
description: Read fixed inputs, execute workspace analysis and publish results backed by frozen host execution evidence.
---

data_read({datasetId}) 读取登记数据；data_read({ref}) 读取固定 DataRef。两者均将完整行写入 directory/inputs，返回实际 path 和有界摘要。原始文件缺失与工具预览截断不同，分析直接从实际文件读取。

用 write/edit 编写独立脚本，明确单位、缺失值、筛选、分母和时间口径；数值转换失败不静默补零。输出为 JSON 对象数组，不允许 NaN/Infinity。workspace bash 返回实际 executionId、进程 Run 与执行回执；research_register 使用 executionId，不使用 Run ID。bash.cwd 与 data_read.directory 指向同一工作区计算目录，保证 inputs 与脚本一起进入执行快照。

research_register 使用 operationId、executionId、path、title、description，以及 inputIds（登记输入）或 inputRefs（固定 DataRef），可附 recipePaths。宿主执行记录必须包含该输出及实际输入、配方快照；缺少冻结证据时直接拒绝，不能用当前文件或手填验证状态替代。输出的 DataRef 可直接交给报告或其他声明能力。

例如 data_read({datasetId,directory:"analysis"}) 写入 analysis/inputs，脚本保存在 analysis/calculate.mjs，bash({command:"node calculate.mjs",cwd:"analysis"}) 的 executionId 对应本次计算；输出为 analysis/result.json 时，research_register.path 使用 "result.json"、recipePaths 使用 ["calculate.mjs"]。这是目录与证据关系示例，不要求特定脚本语言。snapshotErrors 提示文件过多、过大或不安全链接时，将必要输入与脚本集中到独立计算目录后重算；缩小工具输出文本不能补回缺失的文件快照。

统计结论、SVL 固定事件回放、原生引擎回测有不同验证范围。代码成功退出只证明该次执行完成，不能替代方法、样本和目标引擎证据。工作区进程使用当前系统用户权限；使用实际返回路径，不假设 /work 是挂载点。
