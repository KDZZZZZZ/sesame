工作区文件编辑使用 read、write、edit。相对路径解析到当前 workspaceRoot；写入和编辑拒绝越界及跳出工作区的符号链接。edit 对原文件作唯一且不重叠的替换，保留BOM和换行，提交前核对完整文件摘要。

需要显式绝对路径时使用 host_files_*，它们按宿主 filePolicy 保护应用控制数据、认证目录和其他任务私有区，检查真实路径、普通文件及硬链接。覆盖需 overwrite，冲突使用 expected_sha256；删除仅普通文件或空目录，不递归删除树。导入返回受管资源引用和原始哈希。

bash 与 host_files_run 最终调用 host.process.exec，宿主管理实际进程 Run、超时和取消。结果包含实际输出、退出码和Run引用。进程不是OS沙箱；运行成功不等于输出内容已被验证。环境准备流程见 prepare-environment skill。
