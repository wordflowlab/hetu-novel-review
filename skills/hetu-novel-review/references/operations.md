# 操作地图

由正式清单生成，执行前发现当前安装版Schema。

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
| put_state_event | 保存有据状态事件 | object_id, expected_revision, expected_sha256, operation_key, state_event | managed_write |
| preview_rule_run | 执行固定规则与状态检查 | object_id, run | read |
| put_rule_run | 保存可重现规则运行 | object_id, expected_revision, expected_sha256, operation_key, run | managed_write |
| get_rule_run | 重现固定规则运行 | object_id, run_id | read |
| preview_recheck | 比较新旧运行与问题 | object_id, old_run_id, run | read |
| save_depth | 保存明确专业深化结构 | object_id, expected_revision, expected_sha256, operation_key, depth | managed_write |
| inspect_basis | 读取同作品固定专业依据 | object_id, basis_index | read |
