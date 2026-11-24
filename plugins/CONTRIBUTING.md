# 贡献一个 Sesame 插件

从最新的 `dev` 建立工作分支，在仓库根目录使用 Node.js 24。Windows 请使用 LF 检出，例如 `git -c core.autocrlf=false clone …`，文件校验按实际字节计算。

## 1. 创建插件

```sh
node scripts/plugin.mjs new my-publisher/volatility-notes --type knowledge
```

选择 `knowledge`（知识）、`function`（工具）、`adapter`（外部来源）或 `workflow`（工作流）。省略类型时创建知识包。新包在 `plugins/optional-api-v1/packages/<slug>/` 下。社区作者可以使用自己的发布者 ID。修改已有插件时，直接进入其目录。

## 2. 开发并检查

在 `plugin.yaml` 声明身份、版本、宿主范围和权限。`x-sesame.catalog` 中填写分类 `functionalCategory`、双语标题 `title.en/zh` 和摘要 `summary.en/zh`。工具放在 `tools/`，给 Agent 的说明放在 `instructions.md`，可复现的用例放在 `evals/cases/`。选择有权使用的许可证，保留第三方来源。已发布版本的内容有变化时提高版本号。

```sh
node scripts/plugin.mjs check --fix
```

该命令同步各包接口锁、核心与可选发行锁、目录清单，然后运行检查。只检查用 `node scripts/plugin.mjs check`，只同步生成文件用 `node scripts/plugin.mjs sync`。涉及外部服务或业务流程时，在隔离环境中测试实际行为，并记录结果。

## 3. 提交到 dev

把插件目录和自动刷新的文件一起提交。向 `dev` 开 PR，写明插件 ID 和版本、用途、权限与外部依赖、测试结果。贡献者从 fork 提交，仓库维护者可从本仓工作分支提交。PR 校验从受信基线读取验证器，把候选包当作数据读取；运行时测试由作者或维护者在隔离环境执行。

[API 2 包协议](protocol/README.md) · [宿主接口与模板](api-v1/docs/README.md) · [维护者发布流程](api-v1/PUBLISHING.md)
