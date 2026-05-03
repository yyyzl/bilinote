use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

/// 通知导航目标文件名
/// Android 端 MainActivity.kt 会读取此文件获取 note_id
const NAV_TARGET_FILENAME: &str = ".notification_nav_target";

/// 通知类型枚举
pub enum NotificationType {
    /// 转录成功
    TranscribeSuccess { title: String, note_id: String },
    /// 转录失败
    TranscribeFailed,
    /// 转录和总结都成功
    TranscribeAndSummarizeSuccess { title: String, note_id: String },
    /// 转录成功但总结失败
    TranscribeSuccessSummarizeFailed { title: String, note_id: String },
    /// AI 总结成功
    SummarizeSuccess { title: String, note_id: String },
    /// AI 总结失败
    SummarizeFailed,
    /// 思维导图生成成功
    MindmapSuccess { title: String, note_id: String },
    /// 思维导图生成失败
    MindmapFailed,
}

/// 发送完成通知
pub fn send_notification(app: &AppHandle, notification_type: NotificationType) {
    let notification = app.notification();

    let (title, body, note_id) = match notification_type {
        NotificationType::TranscribeSuccess {
            title: note_title,
            note_id,
        } => (
            "转录完成",
            format!("「{}」的转录已完成", truncate_title(&note_title, 20)),
            Some(note_id),
        ),
        NotificationType::TranscribeFailed => (
            "转录失败",
            "转录失败，请检查视频链接或网络连接".to_string(),
            None,
        ),
        NotificationType::TranscribeAndSummarizeSuccess {
            title: note_title,
            note_id,
        } => (
            "转录和总结已完成",
            format!(
                "「{}」的转录和 AI 总结已完成",
                truncate_title(&note_title, 20)
            ),
            Some(note_id),
        ),
        NotificationType::TranscribeSuccessSummarizeFailed {
            title: note_title,
            note_id,
        } => (
            "转录完成，总结失败",
            format!(
                "「{}」的转录已完成，AI 总结生成失败",
                truncate_title(&note_title, 20)
            ),
            Some(note_id),
        ),
        NotificationType::SummarizeSuccess {
            title: note_title,
            note_id,
        } => (
            "AI 总结完成",
            format!(
                "「{}」的 AI 总结已完成，请前往 APP 查看",
                truncate_title(&note_title, 20)
            ),
            Some(note_id),
        ),
        NotificationType::SummarizeFailed => (
            "AI 总结失败",
            "AI 总结失败，请稍后重试".to_string(),
            None,
        ),
        NotificationType::MindmapSuccess {
            title: note_title,
            note_id,
        } => (
            "思维导图生成完成",
            format!(
                "「{}」的思维导图已生成，请前往 APP 查看",
                truncate_title(&note_title, 20)
            ),
            Some(note_id),
        ),
        NotificationType::MindmapFailed => (
            "思维导图生成失败",
            "思维导图生成失败，请稍后重试".to_string(),
            None,
        ),
    };

    // 写入导航目标文件，供 Android 端 MainActivity 读取
    // 必须在 show() 之前写入，确保点击通知时文件已存在
    if let Some(ref id) = note_id {
        write_nav_target(app, id);
    }

    // 构建通知：自动取消 + 附加 note_id（作为 extra 的备用通道）
    let mut builder = notification.builder().title(title).body(&body).auto_cancel();
    if let Some(id) = note_id {
        builder = builder.extra("note_id", &id);
    }

    if let Err(e) = builder.show() {
        eprintln!("Failed to show notification: {}", e);
    }
}

/// 写入通知导航目标文件
/// Android 端 MainActivity.kt 在通知点击时读取此文件获取 note_id
fn write_nav_target(app: &AppHandle, note_id: &str) {
    if let Ok(data_dir) = app.path().data_dir() {
        let target_path = data_dir.join(NAV_TARGET_FILENAME);
        if let Err(e) = std::fs::write(&target_path, note_id) {
            eprintln!("Failed to write notification nav target: {}", e);
        }
    }
}

#[tauri::command]
pub fn consume_notification_nav_target(app: AppHandle) -> Option<String> {
    let data_dir = app.path().data_dir().ok()?;
    let target_path = data_dir.join(NAV_TARGET_FILENAME);

    match std::fs::read_to_string(&target_path) {
        Ok(note_id) => {
            if let Err(e) = std::fs::remove_file(&target_path) {
                eprintln!("Failed to remove notification nav target: {}", e);
            }

            let note_id = note_id.trim().to_string();
            if note_id.is_empty() {
                None
            } else {
                Some(note_id)
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => {
            eprintln!("Failed to read notification nav target: {}", e);
            None
        }
    }
}

/// 截断标题到指定长度，超出部分用省略号表示
fn truncate_title(s: &str, max_len: usize) -> String {
    if s.chars().count() > max_len {
        format!("{}...", s.chars().take(max_len).collect::<String>())
    } else {
        s.to_string()
    }
}
