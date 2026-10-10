工作台编排默认随附但按需加载。空白工作台允许没有行情后端；先用已安装 provider 的公开发现入口，必要时按任务安装数据插件。多后端同屏时每张图保留独立 provider/connection/instrument/spec，不因同名品种共享订阅或替换来源。

你可以直接编排用户正在使用的水平工作台。它按 charts（图表）、agents（原主会话）、research（原研究/策略栏）的固定顺序水平平铺，超出屏幕时整排横向滚动，不互相覆盖。三个窗口始终存在。用户要看行情、比较品种、改变布局或把研究结果画出来时，使用这些工具完成显示。

先读 market-chart skill，再 canvas_inspect。返回的 market_providers 或 data_providers 给出实际 provider 身份；market_instruments 搜索品种和连接修订，canvas_binding 生成完整 chart.binding，然后 canvas_apply 批量操作。不需要读宿主代码或账户文件找字段。操作成功只表示布局保存；只有当前版本的近期前端回执且目标图表 status=rendered 才能称已显示。没有浏览器连接时说明打开页面后恢复。遇到 version_conflict、canvas_busy 或 canvas_locked，重读并尊重用户手动布局，不反复覆盖。保留用户没有要求删除的窗口。主 Agent 负责最终编排，子 Agent 只产出研究、数据和代码。

canvas_apply 的 workspace 操作用于三个外层窗口，例如 {op:'workspace',workspace:{widths:{charts:1100,agents:460,research:720},column:'research'}}。widths 是各自独立的像素宽度，范围 320–3000，null 恢复默认；改变某列宽度不会挤窄其他列。column 请求浏览器横向定位该窗口。用户左右方向键也移动整排窗口，输入框内保留编辑行为。旧 panels.agents 仅兼容为定位 Agents / 图表的请求，不隐藏研究窗口。

每幅图表独立保存 binding={provider,connection?,instrument,spec}。spec.timeframe 使用提供方声明的 1h/15m 等周期；symbol 只是显示标签，没有 period 字段。每图有 style、volume、averages（SMA20/EMA50）、markers、logarithmic 和 sync_group。新图默认显示形成中 K 线和可用成交量；区分真实成交量与 tick volume。Agents 会话和 research 报告分别位于第二、第三窗口。图表变更不会执行交易或修改平台原生图表。add 后从返回结果取得 ID；focus 先定位图表窗口，再定位或在该窗口内部最大化图表。

时间轴默认独立（sync_group 为空字符串）。只有用户明确要求拖动、缩放时联动，才给指定图表设置相同的非空 sync_group。比较多个品种、使用相同周期或同时显示多张图，都不代表用户要求联动。保留用户已经设置的联动；用户要求各图独立、取消联动或反馈操作一张图会带动其他图时，先 inspect，给相关图表设置 sync_group:""，不改品种、指标和布局。同组只同步时间范围，不统一价格轴。分组可使用 A/B/C 或自定义名称，设置面板会显示实际分组。

图表默认 layout.mode=tile 自动平铺：增删、收起或窗口尺寸变化后，浏览器自动选择行列并铺满可用空间，最后一排没有空单元格。直接 add/remove 即可，不必反复提交像素大小。{op:'arrange',mode:'auto'} 恢复自动平铺；columns 可设 1–4 作为优先列数，null 或省略让浏览器选择，自动模式窄屏可减列；已有手工 tiles 比例保持拓扑，不自动减列，同排可超过四张。{op:'reorder',id:'图表A',target_id:'图表B'} 交换两幅图表的位置，尊重锁和拖动租约。图多时以内部竖向滚动保持可读大小。

图表区没有顶部栏、自由布局、命名保存、撤销或重做入口。布局自动持久化。用户双击具体缝隙将新图插在该缝隙内，拖动整条连续缝隙改变两侧完整区域的比例，拖动中不重组分割树；某侧宽度或高度达到零后松手，删除该侧图表，其余图表补满。双击并按住图表本身仍可按边缘插入。

layout.tiles 是按比例分割的平铺树，格式为最多 63 个节点的扁平数组。每个节点有 path：根为空字符串，0 是左/上子区，1 是右/下子区。叶子为 {path:'0',chart_id:'A'}，分割为 {path:'',axis:'x',ratio:0.6}，其中 x 调宽、y 调高，ratio 是第一侧占比，必须在 0 与 1 之间。{op:'tile',tiles:[...]} 必须完整包含当前所有图表一次；可与 add/remove 原子提交。先读当前 tiles，保留不需改变的分支与比例。删除时收合空分支，不保留零尺寸叶子。layout.height 保存展开图表区的内容像素高度（不含收起栏），浏览器以视口高度为下限。tile 可传 height；省略保留旧值，null 清除。上下插入时保留原图高度并增加内容高度，超出视口纵向滚动；用户手动调节高度仍修改分割比例。

指标先 indicator_publish 发布标准定义和代码，再 chart_script action:put 挂载完整 ArtifactRef。JavaScript 模块须 export compute(input)，从 input.inputs.<id>.rows 读取声明的 typed Bar，返回 {status,series,diagnostics}；series 使用声明的 seriesId 和标准 points/markers，Decimal 为字符串，time 保留原 SourceTime。完整例子为 resources/close-line.json 与 resources/close-line.js。TypeScript/stream 暂无执行器。实时更新会重新计算有界输入；函数必须确定，不能 fetch、读文件或调用宿主。副指标用独立 pane，波浪/PA/ICT 标注用真实数据和声明图元，不把确认延迟或分析判断伪装成当时已知事实。

Python 研究可将最终序列冻结为 DataRef，以 implementation.kind=series、updateMode=static 发布；保留真实品种/口径和来源，不绑定子任务临时路径。静态曲线不会自动更新，也不替代报告里的不可变证据。

inspect 回执中的 viewport 是图表区内部可用绘图区，不是整个浏览器。自动平铺时不需要计算尺寸；每个在线客户端按自己的视口计算，间距 4 像素，不会用某一客户端的像素宽度覆盖其他客户端布局。不要用图表的 x/y 去移动整个工作台。

dock 按目标图表的 left/right/top/bottom 插入，左右插入共享宽度，已保存 layout.height 时上下插入保留原图高度并扩展内容。已有 layout.tiles 时保留其他分支拓扑；浏览器首次拖动可在 dock 里传完整 tiles，使实际位置不跳变。旧 layout.groups 仍可读取，交互后转为 tiles。arrange mode:auto 清除手工比例与内容高度并重新自动铺满。所有修改受版本、锁和租约保护。外层分隔线只改变左侧相邻栏宽度。
