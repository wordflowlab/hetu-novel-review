# 小说审校功能清单

本包拥有专业能力；宿主拥有正文、来源与作者决定。

| 动作 | 用途 | 必填参数 | 效果 |
| --- | --- | --- | --- |
| list_projects | 查找方案 |  | read |
| get_project | 读取固定方案 | object_id | read |
| save_project | 保存完整方案 | expected_revision, expected_sha256, operation_key, content | managed_write |
| put_check | 维护检查 | object_id, expected_revision, expected_sha256, operation_key, check | managed_write |
| put_issue | 维护问题 | object_id, expected_revision, expected_sha256, operation_key, issue | managed_write |
| set_disposition | 维护问题处理 | object_id, expected_revision, expected_sha256, operation_key, issue_id, disposition, resolution, resolution_source_indices | managed_write |
| run_local_checks | 执行本地规则 | object_id, source_index | read |
| get_coverage | 读取审校覆盖 | object_id | read |
| build_review_context | 准备审校上下文 | object_id, goal, max_chars | read |
| get_source | 读取固定依据 | object_id, source_index | read |
| compare_versions | 比较专业修订 | object_id, from_revision, to_revision | read |
| export_project | 导出固定报告 | object_id, format | read |
| get_operation | 回读原操作 | operation_key | read |

默认流程、边界及验收见 [docs](docs/README.md)。
