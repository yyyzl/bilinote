pub mod asr;
pub mod auth;
pub mod bilibili;
pub mod commands;
pub mod connection_test;
pub mod error;
pub mod llm;
pub mod notification;
pub mod retry;
pub mod store;

use commands::{cancel_all_tasks, AppState};
use std::collections::HashMap;
use std::sync::atomic::AtomicUsize;
use std::sync::{Arc, Mutex};
use store::Store;
use tauri::{Manager, RunEvent};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 创建全局取消令牌
    let global_cancel = CancellationToken::new();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| {
            let store = Store::new(&app.handle())?;
            // 从配置读取最大并发数（默认 2，限制在 1-5）。修改后需重启应用生效。
            let max_concurrent = store
                .load_config()
                .map(|c| c.max_concurrent_transcribe)
                .unwrap_or(2)
                .clamp(1, 5);
            app.manage(AppState {
                store: Mutex::new(store),
                tasks: Mutex::new(HashMap::new()),
                task_handles: Mutex::new(HashMap::new()),
                global_cancel: global_cancel.clone(),
                transcribe_gate: Arc::new(Semaphore::new(max_concurrent)),
                llm_gate: Arc::new(Semaphore::new(max_concurrent)),
                active_tasks: Arc::new(AtomicUsize::new(0)),
            });

            // 启动时清理可能残留的任务标志：上次若被系统强杀，未走 RunEvent::Exit 清理路径，
            // .task_running 会残留，导致 Android 端 FileObserver 误判为有任务而启动幽灵前台服务。
            // 新进程内必然没有正在运行的后端任务（tokio 任务不跨进程存活），直接清除是安全的。
            if let Some(flag_path) = commands::get_task_flag_path(app.handle()) {
                println!("[BiNote] task flag path = {:?}", flag_path);
            }
            commands::set_task_flag_file(app.handle(), false);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::get_notes,
            commands::get_note,
            commands::delete_note,
            commands::parse_link,
            commands::get_video_info,
            commands::transcribe,
            commands::summarize,
            commands::start_transcribe,
            commands::get_task_status,
            commands::list_tasks,
            commands::start_summarize,
            commands::start_mindmap,
            commands::cancel_task,
            commands::verify_sessdata,
            commands::test_llm_connection,
            commands::test_asr_connection,
            commands::qrcode_generate,
            commands::qrcode_poll,
            commands::get_login_status,
            commands::logout_bilibili,
            notification::consume_notification_nav_target,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        match event {
            RunEvent::ExitRequested { .. } => {
                // 应用退出请求，取消所有任务
                let state = app_handle.state::<AppState>();
                state.global_cancel.cancel();
            }
            RunEvent::Exit => {
                // 应用退出，清理所有资源
                let state = app_handle.state::<AppState>();
                cancel_all_tasks(app_handle, &state);
            }
            _ => {}
        }
    });
}
