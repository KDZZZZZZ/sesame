# 每轮完成后收起过程

已更新当前 Sesame：每轮有明确最终回复时，中间的思考、工具调用、过程说明和压缩记录自动收进“查看过程”，最终回复留在外面。用户可重新展开回看。

用户插入消息、报告引用、附件和复制入口保持可见。生成期间仍实时展示；暂停、失败或没有最终回复标记时保留已有内容。普通、思考、详细模式均默认收起完成轮次的外层过程；手动重新展开后，切换模式或标签不会覆盖选择。

## 实现

- `transcript-grouping.mjs` 在可见性过滤前划分完成轮次，真实用户输入与最终回复是边界，原始记录不变。
- `reply-segments.tsx` / `reply-segments.css` 复用已有 disclosure 展示折叠过程；`tool-group-expansion.mjs` 复用有容量限制的缓存，独立保存外层开关。
- `transcript-disclosure.tsx` 补充来源属性。自动收起若隐藏了当前键盘焦点，仅将焦点移到对应“查看过程”，不滚动页面、不抢输入框焦点。
- 更新来源说明，新增完成态单元与浏览器测试，适配旧浏览器测试的查看过程步骤。没有新增依赖或修改宿主/插件接口。

## 验证

- 37 项单元测试通过，覆盖最终回复、缺失最终标记、暂停/失败、来源边界、用户插入、模式与操作摘要。
- TypeScript 检查通过；frontend lint 无错误，仅保留原有 Fast Refresh 警告。
- 生产构建通过，保留原有 bundle 体积提示。
- 六套浏览器回归通过：completion（11组）、status、intent、transcript、turns、view-modes。无 pageerror；测试使用隔离数据，没有发送真实模型请求。
- 独立复核发现并修复了自动折叠造成的键盘焦点丢失；工具按钮、思考按钮、输入框三个场景复测通过。
- 已检查完成态、用户输入边界和窄屏截图。

## 当前窗口

加载 JS `/_app/index-CpS-V1Xv.js`、CSS `/_app/index-DPXQLjpx.css`。宿主 PID 10648 不变，仍使用原 E: 运行目录 `E:/brief2great/sesame/mt5agent/output/desktop-run-20261023-Ghxz3z`，只刷新前端。

原会话、消息、报告、标签页与展示偏好均保留；58 个插件、模型 `openai/gpt-6.1-sol`、max 档位、已有设置/密钥/插件配置核验一致。没有中断或恢复研究任务。

现场核验：7 个过程段默认关闭，6 个最终回复可见，没有最终回复或用户输入被放进折叠区。当前正在生成的轮次继续实时展示。

证据见 `ui-deployment.json`、`live-after.png`、`completion-ui/result.json` 及其他 UI 目录。本次独立差异为 `task.patch`，文件哈希及原始基线列于 `change-manifest.json`，未混入之前的未提交修改。
