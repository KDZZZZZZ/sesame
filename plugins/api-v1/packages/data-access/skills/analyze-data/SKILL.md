---
name: analyze-data
description: 读取固定输入，在独立工作区目录执行计算，再用宿主冻结的执行证据登记可复查结果。
---

# 分析固定输入

## 1. 选择并读全输入

已知固定 DataRef 直接 data_read({ref})；宿主登记数据使用 data_read({datasetId})。需要查登记目录时 data_read({}) 分页列出，不能把插件私有数据集 ID 或成果 ID 当成宿主 datasetId。私有数据先经所属来源查询并固定，再读取返回的 ref。

将完整行写入独立计算目录的 inputs，分析从返回的实际 path 读取；sample 是摘要，预览截断不等于原始文件缺失。固定 JSON 导入上限为 100000 行、8 MiB，不能假定所有 16 MiB 采集结果都能一次导入。目录与完整引用的规则见 [执行证据](references/execution-evidence.md)。

## 2. 编写并执行计算

用 workspace write/edit 编写独立脚本，明确单位、缺失值、筛选、分母和时间口径；转换失败不静默补零。输出为 JSON 对象数组，不允许 NaN/Infinity。data_read.directory 与 bash.cwd 指向同一计算目录，使输入和配方进入同次执行快照；使用实际返回路径，不假设 /work 是挂载点。工作区进程使用当前系统用户权限。

## 3. 登记可复查的结果

从成功的 workspace bash 结果取 executionId，以 research_register 关联冻结的输入、配方与输出；Run ID 不能替代 executionId。inputIds 对应宿主登记输入，inputRefs 对应完整固定 DataRef，至少提供一种。path 和 recipePaths 相对该次执行目录，不能用后来修改的文件或手填成功状态替代冻结证据。

snapshotErrors 表示需要的文件证据可能缺失；按实际诊断将必要输入、脚本和输出集中到独立目录后重算。缩小工具输出文本不能补回文件快照。

## 4. 交付并核对结论

登记返回的 DataRef 可直接交给报告或其他声明能力。只在需要可复用计算成果时登记，研究报告仍由报告流程实际发布。成功执行、统计结论、SVL 固定事件回放和原生引擎回测分别验证，不能用代码成功退出替代方法、样本或目标引擎证据。
