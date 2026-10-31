# Factor input handoff implementation

2026-10-21（UTC），限定 factor-evaluator 包内的输入断链修复完成，尚未安装或调用真实业务模型。

## 行为

`auto_factor_start.config.evaluator.arguments.inputRef` 通过已有 options 透传路径进入 evaluator。prepare 现在接受且仅接受 `dataset_id` 或完整固定 `kind:data/schemaVersion:1.0.0` Ref；不创建宿主 dataset、不用工作区路径中转，不转换原始行情或补造时点字段。

固定输入读取前后校验 Ref 结构、精确 manifest 摘要、json-rows/schema、provenance、实际 blob 摘要、返回源身份、连续完整分页、rowCount、20000 行和 4 MiB 限制。已有 prepareDataset 数值/PIT/访问边界仍负责面板语义。返回的 `data.inputRefs`、原 provenance 和 dependencies 均保留，完整 Ref 参与新的冻结输入摘要。原 dataset_id 摘要规则不变。

重试复用原会话，同 run 换 revision 即使行相同也拒绝；不同 run 的输入摘要不同。candidate 的冻结校验和可携带归档 `scripts/reproduce.mjs` 都调用同一个 inputDigest helper，防止只修 prepare 却使后续测量或复现失效。

## 修改范围

- `evaluator.js`：固定输入正式资源读取与校验、来源保留、统一摘要。
- `capabilities.json`：严格 inputRef/options schema、effects 和公开调用说明。
- `prompt.md`、`README.md`、`PROTOCOL.md`：二选一输入、来源/报告交接、restricted 角色上下文注意事项。
- `scripts/reproduce.mjs`：归档复现使用完整输入身份。
- 新增 `tests/input-ref.test.js`：真实数值闭环、原入口、幂等与 revision、错误输入/来源/摘要/分页/大小、PIT、development-only、取消、CLI 归档复现和篡改拒绝。

修改前的六个既有文件在 `before/`，新测试文件没有预先存在。没有改版本、lock、inventory、Git index、宿主或安装数据；没有提交。

## 验证

- 先运行新增正向回归，得到 `dataset_id is required`，证据在 `product-red-test.txt`。
- 包内全部测试 **52/52 通过**：`package-tests.txt`。包含既有 engine/protocol 和新输入测试；只用合成行与内存正式端口替身，CLI 复现测试使用独立临时 JSON 后清理。
- 公开能力 schema 由宿主纯 `schemaValidator` 编译验证，**5 项接受/拒绝通过**：`schema-results.txt`。没有创建 Runtime/Store。
- 三个变动 JS/MJS 通过 `node --check`，能力 JSON 解析通过。
- oxlint 无错误，4 个未使用变量警告来自原 `saveSession` 解构，已与 `before/evaluator.js` 确认相同；新代码无新增警告。`lint-results.txt` 保留输出。

## 主线程仍需完成

1. 由主线程处理 auto-factor-mining 的 options 使用文档、报告 `data.inputRefs` 依赖绑定及集成测试。
2. **restricted 角色 context 必须隐藏全量源引用。** 当前 runtime.context 原样传 config/data；完整 `config.evaluator.arguments.inputRef`、`data.inputRefs`、`data.dependencies`、provenance.references 可被自带 host.resources.read 的角色用于读取原始留出。评估器只返回 development.rows 并不足以消除这个访问路径。主会话/归档保留来源，受限角色给开发证据和不可寻址摘要。该工作在已分配给主线程的范围内，本子任务没有越界修改 runtime。
3. 两个受影响插件的版本/摘要/正式安装与真实模型复测统一由主线程处理。需要新任务真实公开入口链路成功，才能把本轮记为真实使用验收通过；不得将这些合成测试当作真实因子研究完成。
