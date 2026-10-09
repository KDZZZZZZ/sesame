---
name: interactive-report
description: 使用 report/1 固定数据只读桥创建可筛选、可选中并可离线重开的 Agent-authored HTML 报告。
---

# 固定输入上的交互

报告代码只能读发布时绑定的资源。`window.report.ready` 是 Promise；`track(promise)` 让宿主等待真实渲染工作；`getContext()` 获取主题、语言与当前报告身份。`subscribeContext(callback)` 更新主题等上下文，并返回取消订阅函数。

数据：`readData(id,{cursor,limit})` -> `{rows,page:{nextCursor}}`。`id` 是 report_publish.data 的本地绑定 ID；不是 dataset ID，也不能读取未绑定记录。用 `SesameCharts.readRows` 可处理多页与行数预算。

相关证据：`readArtifact(ref)` 只接受成果 dependencies 的完整固定引用；`readRun(id,version)` 只读 related 绑定的版本。`readStrategy` 是宿主给固定 artifact 的只读便捷入口；没有下单、编译、联网、凭据或任意 RPC。

交互用真实固定行实现筛选、选择、视图切换。图形 mark 支持键盘 Enter/Space 和 click；onSelect(row,index) 可联动精确表格。不要把可点的空控件当交互。数据失败时显示原因，并让 track 收到失败。

为离线重开，HTML/JS/CSS/图片全随 report_publish 发布；允许 data URL，不能依赖 CDN、网络字体、远程图像或动态 import。自定义资源用 assets 声明相对路径与真实 MIME 类型。禁止 iframe/form 等嵌套外部交互；宿主独立执行 CSP 与摘要校验。

验收至少覆盖初次打开、再次打开、筛选无结果、键盘选择、缺失值、390px 窄屏、主题变化和外部网络不可用。保持演示标签与真实来源注释。渲染证据来自宿主，不由报告自己签发。
