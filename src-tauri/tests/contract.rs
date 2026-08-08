//! 契約測試 —— 驗 Rust 端的行為與 `docs/BRIDGE.md` 一致。
//!
//! 這裡測的是**移植最容易搞砸的地方**，不是覆蓋率：
//!
//! - append 是不是真的 O_APPEND（§6 明文要求的併發案例）
//! - 「不是錯誤的缺席」有沒有變成錯誤
//! - `ahead = -1` 的語意有沒有被正規化掉
//! - 掃描的上限與去重

use specforge_lib::testing::{append_line, scan_plans};
use std::fs;
use std::path::PathBuf;

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("sf-contract-{name}"));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}

/// **BRIDGE.md §6 指名的那條。**
///
/// read-modify-write 在單執行緒下完全正確，在併發時會靜靜吃掉事件。
/// 八條執行緒各寫 50 行，最後必須是 400 行 —— 少一行就代表有人被覆蓋了。
#[test]
fn append_is_real_o_append_under_concurrency() {
    let dir = tmp("append-concurrent");
    let log = dir.join(".specforge/log/2026-08.jsonl");

    let threads: Vec<_> = (0..8)
        .map(|t| {
            let log = log.clone();
            std::thread::spawn(move || {
                for i in 0..50 {
                    append_line(&log, &format!(r#"{{"t":{t},"i":{i}}}"#)).unwrap();
                }
            })
        })
        .collect();
    for h in threads {
        h.join().unwrap();
    }

    let text = fs::read_to_string(&log).unwrap();
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    assert_eq!(lines.len(), 400, "有事件被覆蓋 —— append 不是真的 O_APPEND");
    // 每一行都必須是完整可解析的 JSON：交錯寫入會產生半行
    for l in &lines {
        serde_json::from_str::<serde_json::Value>(l)
            .unwrap_or_else(|_| panic!("壞行，寫入被交錯了：{l}"));
    }
}

#[test]
fn append_creates_dir_and_gitattributes_once() {
    let dir = tmp("append-attrs");
    let log = dir.join(".specforge/log/2026-08.jsonl");
    append_line(&log, "{}").unwrap();

    let attrs = dir.join(".specforge/.gitattributes");
    assert!(attrs.exists(), "缺 .gitattributes");
    assert_eq!(fs::read_to_string(&attrs).unwrap(), "*.jsonl merge=union\n");

    // 使用者改過就不能被覆寫
    fs::write(&attrs, "custom\n").unwrap();
    append_line(&log, "{}").unwrap();
    assert_eq!(
        fs::read_to_string(&attrs).unwrap(),
        "custom\n",
        "覆寫了使用者的設定"
    );
}

#[test]
fn append_flattens_newlines_so_one_event_is_one_line() {
    let dir = tmp("append-flat");
    let log = dir.join(".specforge/log/x.jsonl");
    append_line(&log, "{\"a\":\"line1\nline2\"}").unwrap();
    assert_eq!(fs::read_to_string(&log).unwrap().lines().count(), 1);
}

#[test]
fn scan_plans_only_md_and_dedupes_across_dirs() {
    let dir = tmp("scan");
    fs::write(dir.join("a.md"), "# A").unwrap();
    fs::write(dir.join("b.txt"), "not a plan").unwrap();
    fs::write(dir.join("c.md"), "# C").unwrap();

    let d = dir.to_string_lossy().to_string();
    // 同一個目錄傳兩次 —— 兩個專案綁到同一個資料夾的情況
    let scan = scan_plans(&[d.clone(), d]);

    assert_eq!(scan.files.len(), 2, "只收 .md，而且要跨目錄去重");
    assert!(
        scan.files.iter().all(|f| f.mtime_ms > 0.0),
        "mtimeMs 必須有值"
    );
    assert!(scan.files.iter().all(|f| f.path.ends_with(".md")));
}

#[test]
fn scan_plans_skips_unreadable_dirs_without_failing() {
    let scan = scan_plans(&["/definitely/not/a/dir".into()]);
    assert!(scan.files.is_empty(), "讀不到的目錄要跳過，不是炸掉");
}

#[test]
fn scan_plans_skips_empty_and_oversized() {
    let dir = tmp("scan-size");
    fs::write(dir.join("empty.md"), "").unwrap();
    fs::write(dir.join("huge.md"), "x".repeat(600 * 1024)).unwrap();
    fs::write(dir.join("ok.md"), "# ok").unwrap();

    let scan = scan_plans(&[dir.to_string_lossy().to_string()]);
    assert_eq!(scan.files.len(), 1);
    assert_eq!(scan.files[0].name, "ok.md");
}
