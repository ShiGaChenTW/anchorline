//! Anchorline —— Tauri 殼。
//!
//! 這個 crate 只做一件事：把 `docs/BRIDGE.md` 列舉的十二個 action 實作出來，
//! 並且**只實作那十二個**。前端拿不到 shell、拿不到任意檔案讀寫、拿不到任意
//! 程式執行；它只能說「對哪個已授權的專案做這件已列舉的事」。

mod commands;
mod exec;
#[cfg(target_os = "macos")]
mod js_dialogs;
mod paths;

/// 契約測試用的入口。
///
/// `#[tauri::command]` 函式吃 `State<..>`，整合測試裡拿不到 App handle，
/// 所以把可測的核心抽出來從這裡露出去。**只給測試用**——正式流程一律走
/// command，那裡才有守門。
pub mod testing {
    pub use crate::commands::{
        append_line, scan_plans, valid_commit_hash, valid_history_name, valid_repo_rel_path,
    };
    pub use crate::exec::strip_ansi;
    pub use crate::paths::{
        append_allowed, domain_pack_writable, editable, normalize_line,
        uat_evidence_dest, uat_evidence_name_ok, RegisteredRoots,
    };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // 把「使用者親手選過的資料夾」落地，否則每次重開 App 授權就歸零，
            // 稽核軌跡會靜默停止寫入（append 失敗被前端 catch 吞掉）。
            use tauri::Manager;
            if let Ok(dir) = app.path().app_data_dir() {
                app.state::<paths::RegisteredRoots>()
                    .attach(dir.join("registered-roots.json"));
            }
            // wry 的 WKWebView 沒實作 alert/confirm/prompt —— 在這裡補上，
            // 否則桌面版所有確認框都等於「永遠按取消」（見 js_dialogs.rs）
            #[cfg(target_os = "macos")]
            for (_label, window) in app.webview_windows() {
                let _ = window.with_webview(|wv| unsafe {
                    js_dialogs::install(wv.inner().cast());
                });
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(paths::RegisteredRoots::default())
        .manage(exec::CliOverrides::default())
        .invoke_handler(tauri::generate_handler![
            commands::pick_folder,
            commands::pick_project_folder,
            commands::project_stats,
            commands::tracking_scan,
            commands::uat_handoff_take,
            commands::uat_format_read,
            commands::uat_format_write,
            commands::uat_format_history,
            commands::uat_format_history_read,
            commands::uat_format_log,
            commands::read_file,
            commands::write_file,
            commands::write_domain_pack,
            commands::save_uat_evidence,
            commands::pick_uat_images,
            commands::read_uat_evidence,
            commands::delete_uat_evidence,
            commands::open_uat_evidence,
            commands::is_root_registered,
            commands::append_file,
            commands::read_log,
            commands::open_path,
            commands::openspec_status,
            commands::git_changeset,
            commands::git_commit_diff,
            commands::openspec_probe,
            commands::openspec_init,
            commands::scan_project,
            commands::list_snapshots,
            commands::write_snapshot,
            commands::write_export,
            commands::gh_status,
            commands::onefetch,
            commands::fastfetch,
            commands::set_cli_path,
            commands::probe_clis,
            commands::ping,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
