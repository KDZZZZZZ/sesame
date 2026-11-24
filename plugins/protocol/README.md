# Sesame 插件协议与验证

包由 `plugin.yaml` 声明。工具来自 `tools/*.yaml`，需求来自 `requirements.yaml`，`surface.lock.json` 固定每个可见元素的摘要。核心包和可选包使用相同的读取器。工作流定义和 resolver 位于 `workflow/`。本体安装时同时核验包树和接口锁。

在插件仓库根目录运行以下验证。

```sh
node plugins/api-v1/scripts/inventory.mjs --check
node plugins/protocol/evaluation/verify-cases.mjs
node --test plugins/protocol/evaluation/evaluation.test.mjs
```

最后一项在装有 `bwrap` 和 `prlimit` 的 Linux 上实际运行原生与 stdio 工具。回放按工具名和完整参数匹配固定回执。Windows 桌面通过已安装的 WSL2 运行同一沙箱，默认发行版为 MT5Agent，可用 SESAME_SANDBOX_DISTRO 选择安装了 Node、bubblewrap 和 prlimit 的发行版。两种运行都从指定草稿读取声明和锁。

## 管理草稿与实验

`px.mjs` 的 `--workspace` 指向本地工作目录。草稿在其 `plugin-drafts/` 下。案例、发现、变更和采用记录保存在 `.sesame-evaluation/optimizer.sqlite`。插件界面使用相同命令，并按会话保存自己的账本。维护者可通过 `--record-root` 指向该会话的记录目录。

```sh
node plugins/protocol/px.mjs init --workspace ./study --draft example --id local/example --goal "检查表格行数"
node plugins/protocol/px.mjs surface ls --workspace ./study --draft example
node plugins/protocol/px.mjs surface show --workspace ./study --draft example --element local/example:plugin.description
node plugins/protocol/px.mjs workflow check --workspace ./study --draft example
```

`surface add/set/rm` 接受包内源文件的 `--path`。新增、改写使用 `--text`，同时重算接口锁。通过 `findings add/triage` 保存证据和单一归因对象，再用 `case new` 将案例及回执复制到独立账本。运行 `change new` 时固定 `--baseline`、`--candidate`、`--finding`、`--cases` 和 `--repeats`。随后运行 `change verify --id <变更 ID>`。每个案例提供 JSON 指针和 equals、contains 或 exists 断言，改进和退步逐条计算。

维护者可在本机交互终端执行 `change adopt --id <变更 ID>`。命令重跑固定案例，核对两份包摘要并要求输入完整候选摘要。采用记录只选定本地版本。通过 `change rollback` 可以选择先前的同协议摘要。

`trace ls/show/export` 在命令行使用 `--journal <app.sqlite> --session <会话 ID>`，从桌面实时账本只读查询。插件界面使用宿主授权的本会话数据源。按 `--digest` 可查看请求中各元素的实际顺序、位置和版本。

## 配对试点和校准

`node plugins/protocol/evaluation/pilot.mjs <新目录>` 为突破信号插件和优化器各建立两份草稿，并将原始断言、包摘要、实验 ID 和人工决定状态写入 `pilot-results.json`。这些案例检查工具发现时显示的条件。模型行为改善需要独立标注。

`node plugins/protocol/evaluation/calibrate.mjs <独立标注.json> <预测.json>` 按同一观察 ID 比对定位、类别和归因。标注记录包含 id、source、location、category 和 attribution。人工来源用 human，种植缺陷用 seed。预测另含 detected。报告给出原始命中数、分母和比率，未检出的种植缺陷仍计入分母。
