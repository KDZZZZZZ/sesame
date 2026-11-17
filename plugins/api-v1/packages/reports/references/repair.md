# 修复当前报告

先读 report_read 当前完整 ref 和 report_check 诊断，只修对应组件字段，数据、精度、引用和结论不变。

用 components_describe 核对准确 schema。缺列/来源和不支持组件不能用空数组、演示或自写 HTML/CSS/JS 掩盖，需要计算时交给生产者。

修订用 artifact_id、当前 expected_revision 和新 operation_id。固定 input_ref 内含完整输入，不混入替代 content/style/assets/target。

对新 ref 重做受影响检查，核对统一视觉、公式、数值、链接、窄屏及交互。渲染通过不等于已导出，只在实际结果支持时报告成功。
