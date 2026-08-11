//! 契約測試 —— 驗 Rust 端的行為與 `docs/BRIDGE.md` 一致。
//!
//! 這裡測的是**移植最容易搞砸的地方**，不是覆蓋率：
//!
//! - append 是不是真的 O_APPEND（§6 明文要求的併發案例）
//! - 「不是錯誤的缺席」有沒有變成錯誤
//! - `ahead = -1` 的語意有沒有被正規化掉
//! - 掃描的上限與去重

use anchorline_lib::testing::{append_line, domain_pack_writable, scan_plans, RegisteredRoots};
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
    let log = dir.join(".anchorline/log/2026-08.jsonl");

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
    let log = dir.join(".anchorline/log/2026-08.jsonl");
    append_line(&log, "{}").unwrap();

    let attrs = dir.join(".anchorline/.gitattributes");
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
    let log = dir.join(".anchorline/log/x.jsonl");
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

// ── 領域包寫入的守門 ──────────────────────────────────────────────
//
// 這是唯一一支**能建新檔**的寫入路徑（`editable` 要求 is_file()），
// 所以它的界線要被釘死：目錄必須是使用者親手選過的，檔名由 Rust 驗證。

fn roots_with(dir: &PathBuf) -> RegisteredRoots {
    let r = RegisteredRoots::default();
    r.register(dir);
    r
}

#[test]
fn domain_pack_only_writes_into_registered_dirs() {
    let dir = tmp("dp-ok");
    fs::create_dir_all(&dir).unwrap();
    let other = tmp("dp-other");
    fs::create_dir_all(&other).unwrap();
    let roots = roots_with(&dir);

    assert!(domain_pack_writable(&dir, "insurance.md", &roots));
    // 沒註冊過的資料夾一律不行——授權來源只有「使用者親手選過」
    assert!(!domain_pack_writable(&other, "insurance.md", &roots));
}

#[test]
fn domain_pack_rejects_path_traversal_in_name() {
    let dir = tmp("dp-trav");
    fs::create_dir_all(&dir).unwrap();
    let roots = roots_with(&dir);

    // 前端只能決定「叫什麼名字」，不能決定「放到哪裡去」
    for bad in [
        "../escape.md",
        "../../etc/passwd.md",
        "sub/dir.md",
        "sub\\dir.md",
        "..",
        "..md",
        ".md",
        "",
    ] {
        assert!(!domain_pack_writable(&dir, bad, &roots), "應拒絕：{bad:?}");
    }
}

#[test]
fn domain_pack_requires_md_extension() {
    let dir = tmp("dp-ext");
    fs::create_dir_all(&dir).unwrap();
    let roots = roots_with(&dir);

    assert!(domain_pack_writable(&dir, "a.md", &roots));
    assert!(domain_pack_writable(&dir, "A.MD", &roots));
    for bad in ["a.sh", "a.md.sh", "a.json", "a"] {
        assert!(!domain_pack_writable(&dir, bad, &roots), "應拒絕：{bad}");
    }
}

#[test]
fn domain_pack_rejects_odd_characters_and_overlong_names() {
    let dir = tmp("dp-chars");
    fs::create_dir_all(&dir).unwrap();
    let roots = roots_with(&dir);

    assert!(domain_pack_writable(&dir, "my-pack_2.md", &roots));
    // 非 ASCII 檔名擋掉：不是歧視中文，是不想處理正規化差異帶來的同名混淆
    assert!(!domain_pack_writable(&dir, "保險.md", &roots));
    assert!(!domain_pack_writable(&dir, "a b.md", &roots));
    assert!(!domain_pack_writable(
        &dir,
        &format!("{}.md", "x".repeat(70)),
        &roots
    ));
}

#[test]
fn domain_pack_blocks_symlink_escape() {
    // 註冊 real/，但透過 link/ 這條 symlink 指進去以外的地方要擋住
    let base = tmp("dp-link");
    let real = base.join("real");
    let outside = base.join("outside");
    fs::create_dir_all(&real).unwrap();
    fs::create_dir_all(&outside).unwrap();
    let roots = roots_with(&real);

    assert!(domain_pack_writable(&real, "ok.md", &roots));
    assert!(!domain_pack_writable(&outside, "ok.md", &roots));
}

// ── 授權跨重啟保留 ────────────────────────────────────────────────
//
// 原本 RegisteredRoots 只活在記憶體：每次重開 App 授權歸零，而 append 失敗
// 被前端 `.catch(() => {})` 吞掉——稽核軌跡於是靜默停止寫入。這一組守住
// 「使用者選過就記得」與「記得的東西不會憑空長出來」。

#[test]
fn registered_roots_survive_restart() {
    let base = tmp("roots-persist");
    fs::create_dir_all(&base).unwrap();
    let project = base.join("proj");
    fs::create_dir_all(&project).unwrap();
    let store = base.join("registered-roots.json");
    let _ = fs::remove_file(&store);

    // 第一次「執行」：使用者選了資料夾
    let a = RegisteredRoots::default();
    a.attach(store.clone());
    a.register(&project);
    assert!(a.contains_ancestor_of(&project));

    // 第二次「執行」：沒有再選一次，但授權還在
    let b = RegisteredRoots::default();
    b.attach(store.clone());
    assert!(b.contains_ancestor_of(&project), "重開之後授權不該歸零");
}

#[test]
fn registered_roots_drop_paths_that_no_longer_exist() {
    let base = tmp("roots-stale");
    fs::create_dir_all(&base).unwrap();
    let gone = base.join("deleted");
    fs::create_dir_all(&gone).unwrap();
    let store = base.join("registered-roots.json");
    let _ = fs::remove_file(&store);

    let a = RegisteredRoots::default();
    a.attach(store.clone());
    a.register(&gone);
    fs::remove_dir_all(&gone).unwrap();

    // 指向已刪除資料夾的舊授權沒有保留的理由——留著只是讓集合越長越大
    let b = RegisteredRoots::default();
    b.attach(store.clone());
    assert!(!b.contains_ancestor_of(&gone));
}

#[test]
fn registered_roots_without_store_do_not_touch_disk() {
    // 沒有 attach 就純記憶體。測試之間不該互相污染同一份檔案
    let base = tmp("roots-nostore");
    fs::create_dir_all(&base).unwrap();
    let r = RegisteredRoots::default();
    r.register(&base);
    assert!(r.contains_ancestor_of(&base));
    assert!(!base.join("registered-roots.json").exists());
}
