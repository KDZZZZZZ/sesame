# Plugin-manager：0.2.2 发布前本地验证

日期：2026-10-10。候选包：`sesame/plugin-manager` 2.2.0，要求 Sesame ≥0.2.2。

## 本次范围

- 共享开发 Skill、真实开放接口参考和已有插件示例随插件分发。
- 内部 `plugin_create(template:native)` 与外部 Node CLI 共用生成器。
- 保留已有 skill/MCP 创建路径；原生模板包含可调用的 echo 工具，业务实现仍由作者完成。
- 官网中英文插件文档及 llms.txt 的入口在网站分支准备，同期上线。

## 已执行

匹配宿主：`feat/svl-strategy-pipeline` 的 `6767ab6`（应用版本 0.2.2），相关公开接口与 `dev` 的 `5ca4695` 一致。公共插件基线：`24e70b9`。测试环境：本机 macOS、Node 25.2.1。

| 检查 | 结果 |
| --- | --- |
| scaffold、管理工具 schema、真实宿主创建/安装/加载/调用/重启 | 14 通过，0 跳过 |
| 完整 `test:sdk` 回归 | 379 通过、30 按运行条件跳过，0 失败 |
| 调整兼容范围后的 profiles/scaffold 定向检查 | 10 通过 |
| 默认包内容锁与描述性 inventory | 通过；仅 manager 的包内容/版本更新 |
| Skill 与参考文档的 35 个本地/仓库目标 | 均存在 |
| 官网 `npm run check` | 17 通过 |

宿主集成使用临时数据库、模型配置与插件目录，拦截网络请求，不访问用户当前应用配置、模型或券商。验证内容包括：并发重复创建返回同一草稿、编辑后重试保留文件、同操作 ID 不同输入拒绝、外部 native/skill 包实际安装并执行、读取随包 Skill/参考资料、过期测试摘要拒绝，以及重启后的工具和创建回执。

重跑命令（路径由维护者提供，不复制私有宿主实现）：

```sh
SESAME_HOST_ROOT=/path/to/matching/host \
  node --import /path/to/matching/host/modules/plugins/sdk-loader.js --test \
  plugins/api-v1/tests/plugin-scaffold.test.mjs \
  plugins/api-v1/tests/plugin-manager-schema.test.js \
  plugins/api-v1/tests/plugin-authoring-host.test.mjs

SESAME_PLUGIN_SDK_LOADER=/path/to/matching/host/modules/plugins/sdk-loader.js \
  npm run test:sdk --prefix plugins/api-v1
npm run check --prefix plugins/api-v1
node plugins/api-v1/scripts/inventory.mjs --check
```

## 留给统一验收与发布

这是基础代码与宿主流程验证，不是“模型根据需求自主完成任意插件”的验收，也没有测试真实券商、所有平台或新后端。用户将提供详细插件开发测试方案，再据此补齐正式验收。

本轮不合并主分支、不发布插件归档、不改安装目录、不上线网站，也不修改或发布本体。后续统一发布需要审阅该候选包、生成新的默认包归档并由应用固定其摘要；Skill 的公开 main/raw 链接随源码合并后可用，网站入口同期部署。保留独立审阅和发行流程；这份本地记录不代替发布批准。
