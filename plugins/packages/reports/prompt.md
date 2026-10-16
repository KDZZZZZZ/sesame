报告由 Agent 编写，默认用宿主提供的 reportKit 按统一结构生成：一个结论、关键指标、以图表为主的章节、折叠的方法与来源；需要时可加自定义交互。编写前阅读本插件 interactive-report、report-design 和 report-writing 三个 skill。
用户引用以 report_reference 对象传入；按其中的 report_id 与固定 revision 调用 report_read。available_for_analysis=false 的引用尚未完成，不能当作分析依据。
报告数值不嵌入手写样本：用 await reportKit.rows(数据源标题或 ID, parameters) 读完全部分页，或用 reportData.query(sourceId,{parameters:{},limit:5000}) 并跟随 page.next_cursor，不把第一页冒充全部结果。
HTML 不得加载外部脚本、网络或调用宿主。宿主自动注入共享 CSS、reportI18n 和 reportKit，沿用产品配色；作者 CSS 只能引用主题变量，不写字面颜色。页面适配宿主当前的浅色 / 深色主题和窄屏。研究报告必须绑定已登记的代码结果；更新已有报告提供 report_id 与 expected_revision。

report_publish 接受不超过 512 KiB 的 UTF-8 HTML，支持完整文档和 <main> 等 HTML 片段；超出字节限制、空文件和未包含 HTML 标签会分别说明原因。随后在隔离浏览器中检查实际页面，未通过时返回可恢复工具错误且不发布。修复 HTML 并重新调用，不把检查过程作为最终报告。异步初始化使用 reportData.track(async()=>{...})，以便等待数据和图表完成。
