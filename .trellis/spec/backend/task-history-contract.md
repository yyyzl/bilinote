# 后台任务记录与重试契约

`commands.rs::dismiss_task(task_id: String, state: State<AppState>) -> Result<()>` 注册到 `lib.rs` 的 Tauri handler。前端 `lib/tauri.ts::dismissTask(taskId)` 发送 `invoke("dismiss_task", { taskId })`。

| 输入状态 | 结果 |
|---|---|
| completed / failed / cancelled | 从本进程任务注册表移除，并释放已结束的句柄记录 |
| 任务不存在 | 成功，支持重复移除 |
| queued / running / 其他非终态 | StoreError，保留任务；必须先取消或等待完成 |

此操作只处理内存任务记录，不删除笔记或配置，不取消正在运行的任务。

库页显式移除先等待后台成功，再移除本地记录；有同步请求锁与等待态，失败保留记录并提示。任务重试成功入队后，必须清理旧失败记录，后台清理不能被组件卸载检查跳过。转录启动的布尔返回代表是否成功入队，与是否仍可更新 UI 分开。

Good：失败任务移除/重试后，切页返回不会重新恢复旧失败；Base：重复移除不存在记录成功；Bad：运行中任务拒绝移除。Rust `commands::task_record_tests` 覆盖终态、幂等和拒绝运行态；`scripts/verify-task-consistency.cjs` 覆盖跨页与重试请求迟到返回。

阅读页并发总结/导图完成后只能更新当前任务所属产物：总结更新 summary/preview，导图更新 mindmap。保留 routeVersion 约束，同时拒绝整条旧快照覆盖另一个刚完成的产物。乱序回归使用 Promise 门闩控制 get_note 返回，验证新导图和新总结同时保留。
