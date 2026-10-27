# W1 策略报告 v1 错误页：一次只读定位

对象：`rep_f9452d8f-6deb-4fc3-9e10-67d92b8c44e8`，Strategy，`reports/QA20261020-策略与工作流验收.html`。本次只读取主库 WAL（readOnly、query_only）、本轮 W1 JSONL、该报告固定发布的 HTML/绑定数据和源码；没有打开子 SQLite、调用 API/模型/业务、修改报告或操作桌面。

**结论：这是 v1 作者代码把两个不同样本区间一起传给单一 cohort 的回测矩阵校验，导致初始化中止。`report_check` 已准确诊断，未漏报，也没有把 v1 判为渲染通过。现场看到的是已发布但检查失败的 v1。真实 Agent 随后已自行发布 v2，并取得新 ref 的 rendered 回执。**

## 关键时间线

| UTC | 已核实结果 |
| --- | --- |
| 15:57:28.461 / 工具返回 15:57:28.808 | v1 固定发布；`report_publish` 返回 `renderStatus:"not_checked"`。 |
| 15:57:43.728 → 15:57:48.835 | W1 调用 v1 的 `report_check`。调用本身 `isError:false`，但返回的检查结果明确为 `status:"failed"`、`checks:[]`；1000px 和 390px 均报告同一 cohort 错误。 |
| 15:58:18.848 | 桌面浏览器另保存 v1 `status:"failed"` 回执，错误相同，与截图一致。 |
| 15:59:54.731 → 16:00:47.987 | W1 用原 `artifact_id` 和 v1 的 `expected_revision` 发布 v2，保留同一报告与文件路径。 |
| 16:00:57.142 → 16:00:58.709 | W1 检查 v2，返回 `status:"rendered"`、`diagnostics:[]`，1000/390px 各检查 2 个交互。 |

v1 artifact：`artifact_8163d458-2d43-4883-a611-634b04534494 / revision_91f1173c-22c5-4c0d-acce-50ebe6abab98`，digest `sha256:bf7eb636dca92679e102a9eef9fdc939d82dd934012621d38cd52778b8e5f19c`。

v1 检查：`inspection_d8e8191a-9d4b-4aaf-b2d8-686ee4ef1f2c`，observedAt `15:57:47.715Z`。

v2 artifact：同 ID，`revision_fd21ab9d-b402-4b1e-8be5-e866a1ddf108`，digest `sha256:01b4eb7ac2b0fc528a86589f1e51646552fce0eee6c358d85dd2d349ef30fdd4`。

v2 检查：`inspection_c64678ab-1679-4c0b-b046-d929bf5a7d08`，observedAt `16:00:58.591Z`。本次主 WAL 读取时报告 `last_ready_revision=2`、`status=ready`，对应文件发布摘要已匹配 v2。此处不代替根助手对 v2 当前真实 UI 的视觉验收。

## 根因与完整证据

绑定 `qa-trials` 的固定 DataRef 为 `artifact_b2b311ac-fb65-4c05-91f3-e7c53cdd226b / revision_7ee9f67d-e899-4bc8-b8dd-922898650af1`。实际两行的 `sample` 分别是：

- `2026-10-12 至 2026-10-17（不含终日，券商日期）`，`status=failed`、`selected=false`；
- `2025-10-13 至 2025-10-18（不含终日，券商日期）`，`status=completed`、`selected=true`。

模板 [backtest-explorer.js:42](E:/brief2great/sesame/sesame/plugins/api-v1/packages/reports/assets/backtest-explorer.js:42)要求传入矩阵的 `sample` 去重后只有一个。错误文字提及 training/holdout，但这里能证明的是**两个不同日期 cohort 被混传**；不能据此宣称实际发生训练/留出泄漏。

v1 固定 HTML 第 1276 行先执行 `validate(config.rows, config.parameters)`，第 1280 行才进入 `reportKit.render` 创建标题。校验抛错后，第 1357–1358 行的作者 catch 把 `#report` 内容设置为 `error.message`，因此页面只有错误文本、没有 h1。这是初始化未完成，不是 root helper selector 失效。

同时 `window.report.track` 会在抛出前上报诊断；[artifact-host.js:40](E:/brief2great/sesame/mt5agent/modules/frontend/report-runtime/artifact-host.js:40)、[report-inspection.js:20](E:/brief2great/sesame/mt5agent/modules/agent/report-inspection.js:20)、[report-validator.js:38](E:/brief2great/sesame/mt5agent/modules/agent/report-validator.js:38)将此错误保存在 failed receipt 中。作者自己的 catch 没有掩盖该检查。

v2 固定 HTML 第 1276–1279 行改为按 `row.sample` 分组分别校验；完整两行仍在证据表中。此改动由真实 W1 Agent 完成。本审计没有替它改写或生成报告。

## 为何发布后仍显示 ready

现行 artifact 合同将“固定发布”与“实际渲染检查”分开：

- [reports/index.js:64](E:/brief2great/sesame/sesame/plugins/api-v1/packages/reports/index.js:64)验证资源、绑定和来源后发布，返回 `renderStatus:not_checked`，不在此运行浏览器；
- [runtime.js:761](E:/brief2great/sesame/mt5agent/modules/agent/runtime.js:761)收到固定 report artifact 时建立可读取的报告修订并置 `ready`；
- [reports/prompt.md:11](E:/brief2great/sesame/sesame/plugins/api-v1/packages/reports/prompt.md:11)明确要求随后检查**当前 ref**，只有 receipt 的 `rendered` 才证明该版本渲染通过；失败则修改原 HTML、发布新修订并重查。

因此“允许先固定发布再检查”是当前明确合同；**不是检查误放行**。`report_check` 的正常工具返回只说明检查执行成功，业务检查结果要看 `status/diagnostics`。

最小处理已由 W1 完成：按实际 cohort 组织矩阵，保留失败记录，原路径新修订并检查新 ref。无需本轮产品修复、撤销报告、重做策略或重跑回测。若希望用户永远不看到已发布但检查失败的修订，需另行明确“发布状态/渲染状态”的展示或激活合同，不能以本次检查漏报为理由直接改变发布协议。

机器可核对的受限元数据、固定 HTML 摘要及必要源码片段见 [strategy-report-render-audit.json](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/strategy-report-render-audit.json)。没有把报告正文或完整业务数据复制到审计输出。
