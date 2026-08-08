//! Anchorline —— Tauri 殼。
//!
//! 這個 crate 只做一件事：把 `docs/BRIDGE.md` 列舉的十二個 action 實作出來，
//! 並且**只實作那十二個**。前端拿不到 shell、拿不到任意檔案讀寫、拿不到任意
//! 程式執行；它只能說「對哪個已授權的專案做這件已列舉的事」。

mod commands;
mod exec;
mod paths;

/// 契約測試用的入口。
///
/// `#[tauri::command]` 函式吃 `State<..>`，整合測試裡拿不到 App handle，
/// 所以把可測的核心抽出來從這裡露出去。**只給測試用**——正式流程一律走
/// command，那裡才有守門。
pub mod testing {
    pub use crate::commands::{append_line, scan_plans};
    pub use crate::exec::strip_ansi;
    pub use crate::paths::{append_allowed, editable, normalize_line, RegisteredRoots};
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(paths::RegisteredRoots::default())
        .manage(exec::CliOverrides::default())
        .invoke_handler(tauri::generate_handler![
            commands::pick_folder,
            commands::pick_project_folder,
            commands::project_stats,
            commands::tracking_scan,
            commands::read_file,
            commands::write_file,
            commands::append_file,
            commands::open_path,
            commands::openspec_status,
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
