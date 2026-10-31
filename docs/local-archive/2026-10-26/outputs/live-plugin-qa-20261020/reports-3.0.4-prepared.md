# reports 3.0.4 已准备，未安装

- 路径：`E:/brief2great/sesame/outputs/live-plugin-qa-20261020/staging/reports-3.0.4`
- sourceDigest：`sha256:e1135bdd30e3365312836f3f6b035d2fde6d3a3c290522b0199cc0954f90d826`
- 新包 digest：`sha256:8c93df6bddbe120b452538446527c4eb5e95000384fee9d9698ccf71d9a0156f`
- 已核验基线：reports 3.0.3 / `sha256:090ca3886797bfd4a6a14cc4689225f3268b951c28fa89a01b4921c8568614a5`

本包明确裸 `dataset_id` 只指 `host#datasets` 宿主登记数据；MT5 等插件回执必须沿用其原来源的完整 SourceRef，传 `source+input:{datasetId}+title`，不同时传顶层 `dataset_id`。现有 DataRef 直接复用。没有新增自动跨来源查找、注册副本或错误恢复逻辑。

源码只改四份说明：

1. `capabilities.json`：`report_data` 的 `dataset_id.description`、`usage.inputs`、`usage.limitations[0]`。
2. `prompt.md`：区分宿主快捷形状和插件来源形状。
3. `skills/interactive-report/SKILL.md`：同步数据冻结步骤。
4. `skills/report-writing/backtest.md`：同步回测报告的数据入口说明。

staging 额外将 `plugin.json`、`package.json` 的版本从 3.0.3 改为 3.0.4。源码版本未改。包共 36 个文件，其中 30 个与基线逐字节一致；本轮源码其余 32 个文件未变。处理逻辑、接口字段/校验约束、依赖声明均未变。将上述三条说明字符串替换为固定标记后，capabilities 规范化摘要前后均为：

`sha256:5da4c2e1fce08052334067212efe5efb1b4f8ae7f122062235185d2434503554`

本轮开始时，源码与已知 3.0.3 安装修订目录的全部差异仅为两个版本字段，确认没有漏掉已部署的样式/导出说明，也没有带入其他未部署源码变化。准备后再次核对该安装目录未变。本次没有访问数据库，因此父任务仍须在实际更新时重新核对活动安装版本和依赖锁。

验证：

- 4 个纯 mock 命名空间测试及 1 个现有报告模板测试：**5/5 通过**，见 `reports-namespace-tests.log`。
- 正式 `packageFiles/packageDigest` 完整树校验、`inspectPackage` 声明校验通过。
- 现有隔离 preflight 的 schema/example 与 service/main/subagent 能力工厂检查通过，见 `reports-3.0.4-preflight.log`。
- 全部文件摘要、精确变化清单及保留证明见 `reports-3.0.4-prepared.json`。

父任务在授权的全闲维护窗口核对当前修订、依赖锁及暂停/历史/loadout 保护条件后，使用现有管理入口的输入如下；本次没有提交：

```json
{
  "action": "update",
  "arguments": {
    "pluginId": "sesame/reports",
    "path": "E:/brief2great/sesame/outputs/live-plugin-qa-20261020/staging/reports-3.0.4",
    "digest": "sha256:8c93df6bddbe120b452538446527c4eb5e95000384fee9d9698ccf71d9a0156f",
    "expectedRevision": "sha256:090ca3886797bfd4a6a14cc4689225f3268b951c28fa89a01b4921c8568614a5"
  }
}
```

准备过程没有 Runtime/Store 实例、数据库访问、安装 API、模型请求、真实数据查询或终端调用。没有新增或修改其他依赖，也没有触碰运行中 Agent。`prepare-reports-3.0.4.mjs` 重跑时只核对已有 staging；内容相同则停止，内容不同则报错，不覆盖包或回执。
