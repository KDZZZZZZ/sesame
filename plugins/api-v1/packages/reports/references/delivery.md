# 发布、位置与验收

默认 components_show 发布，返回固定 report ref 后再说明已生成。只登记数据、资源或写草案不等于报告区有报告。

沿用用户指定位置、任务绑定和原报告位置。space 使用 research/strategy 空间，路径不重复包含空间名。单文件不另包同名目录。修改用 artifact_id、expected_revision，不反复新建同名报告。

普通调用可省略 operation_id，由可信调用身份生成；显式重试沿用相同 operation_id，新编辑使用新 operation_id。先查 report_read 取得当前完整 ref 和修订。

长草案按 host.reports.publish 外壳写 UTF-8 JSON，report_prepare({operation_id,path}) 校验并登记完整固定输入，按返回请求发布，不复制重写内容。最小宿主请求示例：

```json
{"operationId":"report-demo-1","title":"演示比较","summary":"","provenanceKind":"demo","data":[],"input":{"lead":"演示：B 的数量是 A 的两倍。","content":{"kind":"document","sections":[{"title":"数量比较","blocks":[{"type":"chart","kind":"bar","rows":[{"项目":"A","数量":2},{"项目":"B","数量":4}],"options":{"x":"项目","y":"数量"}}]}]}}}
```

report_check 检查当前 ref 的真实浏览器结果，核对统一样式、数据、长文本/公式、桌面与窄屏及关键交互。本次 rendered receipt 应对应当前修订，schema 通过不能代替浏览器检查。

导出调用当前可发现的宿主报告导出能力；report_export_check 只检查条件，不生成文件。拿到实际 PDF/图片后才能说导出成功。发布、检查、导出各自只处理变化或失败部分。

历史固定 HTML 包可直接读取、检查、导出，不重解释旧输入；旧稿重新生成改为当前通用组件结构。
