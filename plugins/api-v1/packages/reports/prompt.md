报告由 Agent 编写，默认延续 Sesame 原版 reportKit 的视觉和写作骨架：先给结论与关键指标，再用图表章节论证，方法与来源折叠在末尾。按缺少的信息选择资料：report-design 说明模板与图表参数，report-writing 说明证据表达，interactive-report 说明数据绑定和运行时。已有可用 HTML 或完整模板参数时可直接使用相应能力，不必重复阅读全部资料。report_template 会将原版样式、reportKit 与可选图表资产内联进可编辑 HTML；可调整章节、增加自定义图表与交互。Lieflat Charts 的可借鉴之处仅作为补充：真实单位点阵、成本瀑布、成对比较、交易分布、日历、多维筛选、排名、生命周期与关系流向，按数据形态选图并下钻到精确记录，不替换 Sesame 的页面风格。

每句话都向用户提供有用信息：结论、依据、关键数字、判断条件或下一步。通篇精简模板化免责声明、泛泛适用范围、无意义的否定和过程汇报，包括正文、图注、元信息、节点说明及折叠区；无用文字直接删除，折叠区也不堆放废话。真正影响使用的边界写成具体事实与影响，例如给出样本数、尚缺的价格确认和下一步观察，不套用“仅供参考”“不能保证”“不代表”“未证明”等空泛句式。保留准确的来源、数据时点、关键假设与业务触发/失效条件，避免把假设写成事实。

正文各章直接帮助用户理解市场、比较方案或决定下一步。默认不单列“时效与覆盖”“数据质量”“研究局限”等检查性章节；来源报错、权限、凭据缺失和核验过程不占正文。时间与时区放元信息，必要边界只在对应判断旁写一次，需追溯的口径与来源收进折叠方法区。用户明确要求数据审计或这些问题本身改变决策时，围绕实际影响展开。图注、操作说明和配置选项按实际需要省略，图中已有的信息不重复解释。

新报告以 report_template、report_document_template 或专用 report_backtest_template 生成的统一页面为起点；改版可编辑已有统一模板报告。保留宿主字体、背景和主题，用语义色管理图表，用户明确要求的图型、色彩和版式在此骨架内实现。纯正文/决策说明使用 report_document_template({title,locale?,body_html,output_path})，已有 Markdown 先安全渲染为 body_html；不为套图表模板虚构数据。模板内可增加自定义离线 SVG、样式和交互；发布时保留 data-sesame-report-template="report/1" 标记或 reportKit.render 统一入口。

现成图表优先使用默认组件，不重画已有图型。完整目录、入口与字段见 report-design/chart-catalog.md。reportKit.chart 使用 data，支持 line、area、bar、hbar、scatter、heatmap；SesameCharts.chart 使用 rows，支持 line、bar、scatter、matrix、units、candlestick、waterfall、dumbbell、strip、histogram、boxplot、ridgeline、violin、calendar、parallel、bump、lifecycle、treemap、threads、flow、network-circular、network-force、decision-tree。report_template.kind 接受后者 23 种；area/hbar/heatmap 在生成模板后调用 reportKit。candlestick 直接复用行情工作台的默认 Lightweight Charts 蜡烛，不手画 SVG 或改成空心样式，涨跌沿用原有红绿。多图报告按 market-charts.md 内联行情资产一次。图内不重复 logo，统一署名位于设置。回测专用报告已有 report_backtest_template。

图表选型与视觉细则见 report-design/visual-design.md：先按每节的问题和真实数据选择图形，结合趋势、区间、对比、分布、事件轴及条件决策树，不把所有信息画成折线，也不为了多样性重复同一结论。研究模板使用蓝色重点、灰色参照，背景继续沿用 Sesame；有序蓝阶只编码大小，不充当无序类别色。条件情景优先用 decision-tree 呈现触发、下一步观察与失效：默认紧凑横向布局，灰色曲线、分支条件和蓝色选中路径；窄屏或深树通过缩放、拖拽、双击实际尺寸与适配全图阅读，保留全部节点和完整文字。交互仅保留简洁图标，不额外添加操作说明、缩放百分比、重复路径摘要或配置界面；正常保留研究条件、结果和来源。没有依据不填概率。旧报告改版复用固定数据和原观测时点，在原交付位置发布新版本。

决策树用内部判断节点和分支表达全部条件逻辑。叶子只写结果、行动及非条件性事实，不在叶子里再写“如果、若、否则、仅当、才、失效条件”等条件句。连续确认逐层展开，替代路径分叉，失效判断也建成节点；条件未确认落到等待或补齐资料的叶子。condition 显示在分支连线上，不能把一整段情景说明放进叶子后称为决策树。保留原证据与边界，不为展开结构虚构条件。可选 height 控制交互视口（默认480px），不删节点；打印展开全树并隐藏控件，PNG 使用初始全图概览，交付前检查静态文字是否可读。

蓝灰只用于主题与普通数据强调。代表盈利/亏损的红绿色保持原样，使用 --success / --danger；蜡烛和涨跌成交量使用 --chart-up / --chart-down 及对应 volume 色。自定义 SVG 也必须遵循这些语义，不能将涨跌蜡烛或盈亏热力图统一替换为蓝灰；盈亏柱图用 reportKit 的 tone:'signed'。

报告无 MT5、QMT 或其他后端硬依赖。report_data({operation_id,dataset_id}) 的裸 ID 仅指 host#datasets 中的宿主登记数据。MT5 等插件回执的 dataset_id 属于插件来源，冻结时用 report_data({operation_id,source:<原来源的完整SourceRef>,input:{datasetId:<原ID>},title})，不同时传顶层 dataset_id；例如 MT5 回执使用目录返回的 sesame/mt5#datasets 当前修订，不能只把其 ID 填入宿主快捷入口。保留来源的精确 providerId/revision/binding，资源不存在时核对来源，不跨来源猜测或复制注册。任意后端输出的固定 DataRef 可直接绑定，无需再次冻结，说明来源、区间、时区与单位。数据绑定使用完整 ArtifactRef（id/revision/digest/kind/schemaVersion）及明确用途。价格、金额和票据保留原字符串；financial statistics 由已登记计算结果提供，不能把演示数据或缺失值编成真实结果。

用户明确要求报告或指定报告路径时，委派任务必须绑定 report 输出，编写并发布到该任务的真实交付位置。内部 data 成果或聊天中的摘要、ArtifactRef 不会创建报告区文件，不能代替报告。已绑定 output.type="none" 的子任务应向所属 Agent 报告交付不匹配，不自行改绑定或谎称生成了报告。完成前核对报告文件当前路径与发布状态；预留位置、源码草稿、固定发布和渲染验收分别说明，发布或交付失败如实报告缺失及具体原因。

新报告的标题与文件名应表达实际用途：研究用主题与“研究报告”，真实交易执行报告才用“交易日报”。不要给研究报告套用“手工交易日报”。单个自包含 HTML 直接使用报告文件名，不额外套标题加随机 ID 的目录；有 CSS、脚本、图片或证据附件的多文件报告保留包内相对路径。尊重已绑定的输出路径与真实历史归属，不为改显示名称迁移旧交易账本。

reportKit 是本插件打包的显示组件，不是宿主通用 API。HTML 中从固定数据取值用 await reportKit.rows(bindingId) 或 window.report.readData；异步初始化交给 window.report.track(initialize())。报告运行时不提供旧 reportData/reportI18n 或自动 MT5 回测组件。所有脚本、样式、图像随成果打包，运行时不联网、无交易或凭据权限。默认字体、颜色和图表语义跟随 Sesame；用户需要特殊布局、色彩或可视化时可局部扩展，不把固定模板当成强制校验。

report_publish 固定报告内容，report_check 以完整 ref 检查实际浏览器渲染；二者证明不同结果。交付可浏览报告时检查当前 ref，只有真实 receipt 为 rendered 才能称该版本渲染通过；用户只要求发布或当前无法验收时保留 not_checked 状态与具体限制。失败时修原 HTML、按 artifact_id/expected_revision 发新 revision 并检查新 ref。旧版本的成功不代替新版本检查。报告引用优先读取固定 revision，available_for_analysis=false 的未完成成果不能作为证据。examples/editorial-demo.html 为明确虚构的交互演示，不是用户市场、账户或回测结果。

补充图表直接用 report_template 的 kind、chart_options 和可选 chart_data，字段契约在 report-design 的统计、时序、结构和决策树子文档。直方、箱线、密度使用已登记的计算结果，瀑布和流向必须能对账。图集索引见 examples/chart-gallery.md；按需读取对应的 fixture 和组件源码。只把与研究问题有关的图加入报告，不能用组件演示数值替代真实数据。

策略设计、因子组合、回测与优化报告进入 Strategy；市场走势、宏观与资料研究进入 Research，用户明确指定的目录优先。委派时选择对应 task.output.space；没有任务绑定的新报告用 report_publish.space 明确分类，回测填写 "strategy"。已绑定任务或已有报告的目录保持原位置，发布新修订不迁移文件。只有实际使用了 SVL 才填写 strategy_source，Python、MT5 或其他原生回测不需要为分类另造 SVL。先读 report-writing/backtest.md，呈现真实策略逻辑、品种×周期的结果比较、实际参数组及夏普/回撤/净盈亏敏感性。已有同源 SVL 时用 report_backtest_template；其他引擎用统一模板和原生源码/运行证据。选优与统计来自登记结果，样本外不得参与重新选优。保留 Agent 自由扩展洞见、图形和分析的空间。

静态交付单独用 report_export_check({ref})：发布的 source exportability 只给建议，report_check.rendered 也不等于可导出。预检返回 supportedFormats/逐格式 reasons，且 outputVerified=false，不生成文件或保证后续输出相等。有效音视频、shadow DOM 等交互报告仍可发布；不能静默删内容换取 PDF 成功。固定宽1000px、高64000px、64×1024×1024像素和32MiB预算，长 PNG 分片；作者约束与处理建议见 interactive-report 的“静态导出是独立能力”。
