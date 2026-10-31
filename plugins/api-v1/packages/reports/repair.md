# 修复已发布报告

先读取实际失败诊断和原报告完整 ArtifactRef；报告使用固定 revision，不能按标题猜身份。用 report_read 查看 entry、data、related、资源清单和检查回执，保留全部原绑定。

先调用 host_reports_describe 确认宿主所选提供者及 inputSchema。Report 5 记录完整提供者输入；优先从原报告的 sesame-report-input.json 或原固定 inputRef 读取 input，编辑必要内容或用户要求的样式。旧报告的冻结 HTML 仍可读；旧成果没有结构化输入时，用已保存的真实结果重建相同展示，不重新做研究，不编辑 HTML 后上传。

固定数据 ID、分页、实际列名、单位、缺失值与精确字符串按原结果核对。引用不存在、缺少列或不支持的组件不能用空数组、演示数据或伪造 SVL 遮盖。已有图表与主要交互保留；组件本身的错误交由插件维护者修复，不给报告提交脚本或 CSS。

长内容先把整个 input 原样写为 UTF-8 JSON，登记固定 ArtifactRef，再向 host_reports_publish 提供 inputRef:{ref,entry}。元数据和 data/related/references 仍在发布外壳，不重新抄写整段 JSON 或公式。只修排版时，原数字、选择、留出结果、时点与绑定证据不得变化。

用原 artifactId、当前 expectedRevision 和新 operationId 发布同一报告的新修订。对新完整 ref 调用 report_check，只有本次 receipt 为 rendered 才说明渲染检查完成；不能引用旧修订的通过记录。另核对保存输入与准备稿是否一致，检查公式、数字、引用、桌面/窄屏、关键交互及附录往返。渲染通过不等于内容正确，亦不证明 PDF/PNG 已导出。
