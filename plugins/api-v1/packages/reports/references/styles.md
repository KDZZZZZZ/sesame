# 统一样式

默认统一蓝灰无框排版、宿主背景和字体，不选业务模板，不提交 CSS/HTML/JS。

report_styles 返回默认 tokens、组件和保存样式。用户明确要求调整时，style.custom:{reason,tokens} 可设置受控 accent/context/accent_dark/context_dark、heading、body_size、content_width、section_gap、chart_height、columns，以公开 schema 范围为准。

report_style_save 更新带 expected_version。引用用 style:{saved_id,saved_version} 精确版本，不把后来样式套到历史报告。

涨跌/盈亏使用明确 tone；auto 只接受数值，格式化字符串需显式 positive/negative/neutral。回撤、净值和一般比较保持蓝灰。
