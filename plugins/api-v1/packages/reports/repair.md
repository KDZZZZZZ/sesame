# 修复 report/1 报告

读取实际失败诊断和原报告完整 ArtifactRef；报告使用固定 revision，不能按标题猜身份。用 report_read 查看 entry、data、related、资源清单，保留原绑定。

优先保留原版 reportKit 的视觉与现有交互，检查 `window.report.track(initialize())` 中的错误、固定数据 ID、分页、实际列名、缺失值和 HTML 资源路径。只读桥为 `report.ready`、`readData(id,{cursor,limit})`、`readArtifact(ref)`、`readRun(id,version)`、`getContext()` 和 `subscribeContext(fn)`；reportKit 由报告插件资产提供，只有模板或 HTML 已打包加载 assets/report-kit.js 才可使用。旧 reportData/reportI18n 不存在，也不要调用宿主交易接口。

HTML/JS/CSS/图片须随成果发布，不能用 CDN。修复未打包资源或未声明依赖，不能用空数组、演示数据或 try/catch 隐藏真实加载失败。渲染错误应可见且继续传给 `report.track`。

在原 artifact_id 上带 expected_revision 和新 operation_id 发布修订。保留数据来历与 demo 标签。随后对新完整 ref 调用 report_check，直到实际 receipt 为 rendered 或明确报告仍存在的诊断；用 report_read.include_checks 可复核历史检查。保存成功不等于渲染成功，旧 revision 的成功记录不覆盖新 revision。
