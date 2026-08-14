//! 十二個 action 的 Rust 實作。契約見 `docs/BRIDGE.md` §4。
//!
//! 兩個貫穿全檔的約定：
//!
//! 1. **「不是錯誤的缺席」一律 Ok 一個 unavailable 形狀**，不要 Err。
//!    `openspec` 沒裝、資料夾不是 git 專案 —— 那些是狀態不是例外，
//!    用 Err 表達會讓前端把它當錯誤處理，畫面就跳紅字。
//! 2. **JSON 判讀留在 TS。** 這裡回原始字串，不在兩端各寫一套解析。

use crate::exec::{self, CliOverrides, CliResult};
use crate::paths::{self, RegisteredRoots};
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

const MAX_TEXT_BYTES: u64 = 512 * 1024;
const MAX_PLAN_FILES: usize = 300;

type R<T> = Result<T, String>;

// ── 共用形狀 ─────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedFile {
    path: String,
    name: String,
    /// 位元組。folder-import 的 NativeFolderFile 需要它算覆蓋率
    size: u64,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderPick {
    cancelled: bool,
    folder_name: String,
    folder_path: String,
    files: Vec<ScannedFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanStat {
    pub path: String,
    pub name: String,
    pub mtime_ms: f64,
    pub text: String,
    /// "plan" = `plans/*.md`；"openspec" = `openspec/changes/<id>/tasks.md`。
    /// 兩種檔的內文方言不同，前端要靠這個欄位選 parser —— 用副檔名或路徑
    /// 在前端再猜一次，等於同一個判斷寫兩個地方。
    pub kind: String,
    /// openspec 專用：變更代號（目錄名）。plans 一律空字串。
    pub change: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackingSignal {
    raw: String,
    mtime_ms: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackingScan {
    pub files: Vec<PlanStat>,
    pub signal: Option<TrackingSignal>,
}

/// CLI 不在／不是這種專案。**Ok 回傳，不是 Err。**
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Unavailable {
    unavailable: bool,
    message: String,
}

impl Unavailable {
    fn new(m: impl Into<String>) -> Self {
        Self {
            unavailable: true,
            message: m.into(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", untagged)]
pub enum Maybe<T> {
    Ok(T),
    Missing(Unavailable),
}

// ── 資料夾選擇 ───────────────────────────────────────────────────────

fn scan_documents(root: &Path) -> Vec<ScannedFile> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    let skip = ["node_modules", ".git", "dist", "build", ".next", "target"];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') && p.is_dir() {
                continue;
            }
            if p.is_dir() {
                if !skip.contains(&name.as_str()) {
                    stack.push(p);
                }
                continue;
            }
            let ext = p
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if ext != "md" && ext != "txt" {
                continue;
            }
            let Ok(meta) = e.metadata() else { continue };
            if meta.len() > MAX_TEXT_BYTES {
                continue;
            }
            if let Ok(text) = fs::read_to_string(&p) {
                out.push(ScannedFile {
                    path: p.to_string_lossy().to_string(),
                    name,
                    size: meta.len(),
                    text,
                });
            }
        }
    }
    out
}

fn pick(app: &tauri::AppHandle, roots: &RegisteredRoots) -> FolderPick {
    let picked = app.dialog().file().blocking_pick_folder();
    let Some(folder) = picked.and_then(|f| f.into_path().ok()) else {
        return FolderPick {
            cancelled: true,
            folder_name: String::new(),
            folder_path: String::new(),
            files: vec![],
        };
    };
    // 使用者親手選過 = 授權。這是 append_allowed 唯一的授權來源。
    roots.register(&folder);
    FolderPick {
        cancelled: false,
        folder_name: folder
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default(),
        folder_path: folder.to_string_lossy().to_string(),
        files: scan_documents(&folder),
    }
}

// **這兩支必須是 async。**
//
// Tauri 的同步 command 跑在主執行緒上，而 `blocking_pick_folder()` 會擋住
// 呼叫它的那條執行緒直到使用者選完 —— 在主執行緒上做這件事等於自己鎖死
// 自己：對話框需要主事件迴圈去 pump，但主執行緒正卡在等對話框。
// 表現出來就是點「新增專案資料夾」整個 App 凍住。
//
// 標成 async 之後 Tauri 會把它丟到 async runtime 的 worker 執行緒，
// 主事件迴圈保持自由，對話框才畫得出來。
#[tauri::command]
pub async fn pick_folder(
    app: tauri::AppHandle,
    roots: State<'_, RegisteredRoots>,
) -> R<FolderPick> {
    Ok(pick(&app, &roots))
}

#[tauri::command]
pub async fn pick_project_folder(
    app: tauri::AppHandle,
    roots: State<'_, RegisteredRoots>,
) -> R<FolderPick> {
    Ok(pick(&app, &roots))
}

// ── 專案統計 ─────────────────────────────────────────────────────────

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitStats {
    head: String,
    branch: String,
    last_message: String,
    last_at: String,
    author: String,
    dirty_count: usize,
    remote: String,
    /// **-1 代表沒有 upstream，不是 0。** 前端靠這個分辨「沒接遠端」與「已同步」
    ahead: i64,
    behind: i64,
    tag: String,
    commit_count: i64,
    commits: Vec<serde_json::Value>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStats {
    folder_path: String,
    total_bytes: u64,
    file_count: usize,
    ext_bytes: std::collections::HashMap<String, u64>,
    ext_count: std::collections::HashMap<String, usize>,
    manifests: Vec<String>,
    manifest_bodies: Vec<serde_json::Value>,
    git: Option<GitStats>,
}

const MANIFESTS: &[&str] = &[
    "package.json",
    "Cargo.toml",
    "pyproject.toml",
    "requirements.txt",
    "Gemfile",
    "go.mod",
    "pubspec.yaml",
    "pom.xml",
    "build.gradle",
];

fn collect_git(root: &Path, o: &CliOverrides) -> Option<GitStats> {
    let head = exec::git(root, &["rev-parse", "--short", "HEAD"], o)?;
    let g = |args: &[&str]| exec::git(root, args, o).unwrap_or_default();

    let dirty = g(&["status", "--porcelain"]);
    let dirty_count = dirty.lines().filter(|l| !l.trim().is_empty()).count();

    // @{u} 不存在時整個指令失敗 —— 那不是錯誤，是「沒接遠端」
    let (ahead, behind) = match exec::git(
        root,
        &["rev-list", "--left-right", "--count", "@{u}...HEAD"],
        o,
    ) {
        Some(s) => {
            let mut it = s.split_whitespace();
            let b = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
            let a = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
            (a, b)
        }
        None => (-1, 0),
    };

    let log = g(&["log", "-40", "--pretty=format:%h\x1f%s\x1f%cI\x1f%an\x1f%D"]);
    let commits = log
        .split('\n')
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| {
            let f: Vec<&str> = l.split('\x1f').collect();
            (f.len() >= 4).then(|| {
                serde_json::json!({
                    "hash": f[0], "subject": f[1], "at": f[2],
                    "author": f[3], "refs": f.get(4).copied().unwrap_or(""),
                })
            })
        })
        .collect();

    Some(GitStats {
        head,
        branch: g(&["rev-parse", "--abbrev-ref", "HEAD"]),
        last_message: g(&["log", "-1", "--pretty=%s"]),
        last_at: g(&["log", "-1", "--pretty=%cI"]),
        author: g(&["log", "-1", "--pretty=%an"]),
        dirty_count,
        remote: g(&["remote", "get-url", "origin"]),
        ahead,
        behind,
        tag: g(&["describe", "--tags", "--abbrev=0"]),
        commit_count: g(&["rev-list", "--count", "HEAD"]).parse().unwrap_or(0),
        commits,
    })
}

#[tauri::command]
// async：這支會走完整個專案資料夾再跑好幾條 git，同步版等於在主執行緒上
// 卡住整個 UI 好幾秒。它不像 pick 那樣會死鎖，但畫面一樣是凍的。
pub async fn project_stats(
    folder_path: String,
    overrides: State<'_, CliOverrides>,
) -> R<ProjectStats> {
    if folder_path.is_empty() {
        return Err("缺少 folderPath".into());
    }
    let root = PathBuf::from(&folder_path);
    let mut s = ProjectStats {
        folder_path: folder_path.clone(),
        ..Default::default()
    };

    let skip = ["node_modules", ".git", "dist", "build", ".next", "target"];
    let mut stack = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if p.is_dir() {
                if !skip.contains(&name.as_str()) {
                    stack.push(p);
                }
                continue;
            }
            let len = e.metadata().map(|m| m.len()).unwrap_or(0);
            s.total_bytes += len;
            s.file_count += 1;
            let ext = p
                .extension()
                .and_then(|x| x.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if !ext.is_empty() {
                *s.ext_bytes.entry(ext.clone()).or_insert(0) += len;
                *s.ext_count.entry(ext).or_insert(0) += 1;
            }
            if dir == root && MANIFESTS.contains(&name.as_str()) {
                s.manifests.push(name.clone());
                if let Ok(text) = fs::read_to_string(&p) {
                    s.manifest_bodies
                        .push(serde_json::json!({ "name": name, "text": text }));
                }
            }
        }
    }

    s.git = collect_git(&root, &overrides);
    Ok(s)
}

// ── live tracking ────────────────────────────────────────────────────

fn signal_path() -> PathBuf {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("APPDATA").map(PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .unwrap_or_default();
    base.join("anchorline").join("active")
}

fn mtime_ms(p: &Path) -> Option<f64> {
    let m = fs::metadata(p).ok()?;
    let t = m.modified().ok()?;
    let d = t.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(d.as_secs_f64() * 1000.0)
}

#[tauri::command]
// async：掃 plans/ 每秒會被呼叫一次，別佔著主執行緒
pub async fn tracking_scan(
    plans_dirs: Vec<String>,
    openspec_roots: Option<Vec<String>>,
) -> R<TrackingScan> {
    Ok(scan_plans(&plans_dirs, &openspec_roots.unwrap_or_default()))
}

/// `<root>/openspec/changes/<id>/tasks.md`。
///
/// 只往下一層，且**跳過 `archive/`** —— 封存的變更是歷史，不是待辦；
/// 把它們混進追蹤清單，每個專案的清單都會被幾十個已完成的變更淹掉。
fn scan_openspec(roots: &[String], files: &mut Vec<PlanStat>, seen: &mut std::collections::HashSet<PathBuf>) {
    for root in roots {
        let changes = Path::new(root).join("openspec").join("changes");
        let Ok(rd) = fs::read_dir(&changes) else { continue };
        for e in rd.flatten() {
            if files.len() >= MAX_PLAN_FILES {
                return;
            }
            let dir = e.path();
            if !dir.is_dir() {
                continue;
            }
            let name = dir
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            if name.eq_ignore_ascii_case("archive") || name.starts_with('.') {
                continue;
            }
            let p = dir.join("tasks.md");
            let canon = p.canonicalize().unwrap_or_else(|_| p.clone());
            if !seen.insert(canon) {
                continue;
            }
            let Ok(meta) = fs::metadata(&p) else { continue };
            if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_TEXT_BYTES {
                continue;
            }
            let (Some(ms), Ok(text)) = (mtime_ms(&p), fs::read_to_string(&p)) else {
                continue;
            };
            files.push(PlanStat {
                path: p.to_string_lossy().to_string(),
                name: "tasks.md".into(),
                mtime_ms: ms,
                text,
                kind: "openspec".into(),
                change: name,
            });
        }
    }
}

pub fn scan_plans(plans_dirs: &[String], openspec_roots: &[String]) -> TrackingScan {
    let mut files = Vec::new();
    let mut seen = std::collections::HashSet::new();

    'outer: for d in plans_dirs {
        let Ok(rd) = fs::read_dir(d) else { continue };
        for e in rd.flatten() {
            if files.len() >= MAX_PLAN_FILES {
                break 'outer;
            }
            let p = e.path();
            if p.extension()
                .and_then(|x| x.to_str())
                .map(|x| x.to_ascii_lowercase())
                != Some("md".into())
            {
                continue;
            }
            let canon = p.canonicalize().unwrap_or_else(|_| p.clone());
            // 兩個專案綁到同一個資料夾時會重複掃到同一份
            if !seen.insert(canon.clone()) {
                continue;
            }
            let Ok(meta) = e.metadata() else { continue };
            if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_TEXT_BYTES {
                continue;
            }
            let (Some(ms), Ok(text)) = (mtime_ms(&p), fs::read_to_string(&p)) else {
                continue;
            };
            files.push(PlanStat {
                path: p.to_string_lossy().to_string(),
                name: p
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default(),
                mtime_ms: ms,
                text,
                kind: "plan".into(),
                change: String::new(),
            });
        }
    }

    scan_openspec(openspec_roots, &mut files, &mut seen);

    let sp = signal_path();
    let signal = match (fs::read_to_string(&sp), mtime_ms(&sp)) {
        (Ok(raw), Some(ms)) => Some(TrackingSignal { raw, mtime_ms: ms }),
        // 檔不存在／權限／讀壞 —— 全部不是錯誤，是「退回段 2」
        _ => None,
    };

    TrackingScan { files, signal }
}

// ── UAT 喚醒鏈 ───────────────────────────────────────────────────────

/// UAT 出題 CLI 的交件位置。**路徑在這裡寫死。**
///
/// 前端只能問「有沒有待辦」，不能說「讀哪個檔」—— 讓它指定路徑等於在這個
/// crate 的安全模型上開一個任意檔案讀取的洞（見 `paths.rs` 檔頭）。
///
/// 不跟 [`signal_path`] 共用 XDG 那套：交件檔是 CLI 與 App 之間的約定，
/// 兩邊各自推導目錄規則會在某些機器上指到不同地方，而症狀是「App 跳出來
/// 但什麼都沒發生」—— 那種靜默失效查起來很貴。位置固定成
/// `~/.anchorline/uat-handoff.json`，兩邊照抄同一句。
fn uat_handoff_base() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|h| PathBuf::from(h).join(".anchorline"))
}

/// 取走一份 UAT 交件。**讀到就刪，內容原樣回傳**（JSON 判讀留在 TS，見檔頭約定 2）。
///
/// 沒有待辦回 `None`。這支在每次頁面載入與視窗聚焦時都會被呼叫 ——「沒東西」
/// 是常態不是例外，回 Err 會讓使用者每切一次視窗就吃一次紅字。
///
/// **刪不掉就當作沒讀到。** 交出一份刪不掉的交件，會讓使用者每次聚焦視窗都被
/// 彈回同一份報告，而且沒有辦法停下來。少跳一次，比跳不完好。
#[tauri::command]
pub async fn uat_handoff_take() -> R<Option<String>> {
    let Some(base) = uat_handoff_base() else {
        return Ok(None);
    };
    // 舊版單槽先吃 —— 換版期間 CLI 與 App 可能一新一舊，丟件比多跳一次糟。
    let legacy = base.join("uat-handoff.json");
    if let Ok(text) = fs::read_to_string(&legacy) {
        if fs::remove_file(&legacy).is_ok() {
            return Ok(Some(text));
        }
        return Ok(None);
    }
    // 佇列目錄：一件一檔，依檔名排序最舊先取，一次只取一件 ——
    // 剩下的在下一次載入／聚焦時繼續排空，所以並發交件不會丟。
    let dir = base.join("uat-handoff");
    let Ok(rd) = fs::read_dir(&dir) else {
        return Ok(None);
    };
    let mut files: Vec<PathBuf> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("json"))
        .collect();
    files.sort();
    for p in files {
        let Ok(text) = fs::read_to_string(&p) else { continue };
        // 刪不掉就跳過這一件：交出刪不掉的交件會讓每次聚焦都被彈回同一份
        if fs::remove_file(&p).is_err() {
            continue;
        }
        return Ok(Some(text));
    }
    Ok(None)
}

// ── 檔案讀寫 ─────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRead {
    path: String,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePath {
    pub path: String,
}

#[tauri::command]
// async：讀檔是 I/O，沒有理由佔用主執行緒
pub async fn read_file(path: String) -> R<FileRead> {
    let p = PathBuf::from(&path);
    if !paths::editable(&p) {
        // 一句「不能存取這個路徑」四種原因共用，前端只能原樣轉述，
        // 使用者與維護者都無從下手。分開講，每一種都指得出下一步。
        return Err(paths::why_not_editable(&p));
    }
    let text = fs::read_to_string(&p).map_err(|e| {
        // macOS 的 TCC 會把「App 沒有取用這個資料夾的權限」表現成 EPERM。
        // 這跟「檔案不見了」的處理方式完全不同，必須講出來。
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            format!(
                "macOS 不讓這個 App 讀取「{}」。到「系統設定 → 隱私權與安全性 → 檔案與資料夾」\
                 把 Anchorline 的存取權打開；若清單裡沒有它，請用「專案匯入」重新選一次資料夾。\
                 （原始錯誤：{e}）",
                p.display()
            )
        } else {
            format!("讀不到檔案：{e}")
        }
    })?;
    Ok(FileRead {
        path: p.to_string_lossy().to_string(),
        text,
    })
}

#[tauri::command]
pub fn write_file(path: String, text: String) -> R<FilePath> {
    let p = PathBuf::from(&path);
    if !paths::editable(&p) {
        return Err("不能寫入這個路徑：必須是家目錄底下既有的文件檔".into());
    }
    fs::write(&p, text).map_err(|e| format!("寫不進去：{e}"))?;
    Ok(FilePath {
        path: p.to_string_lossy().to_string(),
    })
}

/// 這個資料夾現在有授權嗎。
///
/// 唯讀查詢，沒有副作用。存在的理由是**授權可能在前端不知情的情況下消失**：
/// 前端把「使用者選過哪個資料夾」記在 localStorage，但真正的授權在 Rust 端。
/// App 更新、換機器、或那份授權檔被刪掉，兩邊就會不同步——而使用者看到的
/// 是「設定頁顯示資料夾好好的，按下去卻說沒授權」。有這支查詢，前端就能在
/// 動手之前先問，然後用系統選擇器把授權補回來（那才是真正的授權來源）。
#[tauri::command]
pub fn is_root_registered(dir: String, roots: State<'_, RegisteredRoots>) -> R<bool> {
    Ok(roots.contains_ancestor_of(&PathBuf::from(&dir)))
}

/// 領域包寫入。`write_file` 建不了新檔（`editable` 要求 `is_file()`），
/// 而 AI 產出與範本下載都需要建新檔——見 `paths::domain_pack_writable`。
///
/// **檔名在 Rust 端驗證**：前端只能說「叫什麼名字」，不能說「放到哪裡去」。
#[tauri::command]
pub fn write_domain_pack(
    dir: String,
    name: String,
    text: String,
    roots: State<'_, RegisteredRoots>,
) -> R<FilePath> {
    let d = PathBuf::from(&dir);
    if !paths::domain_pack_writable(&d, &name, &roots) {
        return Err("不能寫入這個位置：資料夾必須是你親手選過的，檔名只能是單純的 .md".into());
    }
    let target = d.join(&name);
    fs::write(&target, text).map_err(|e| format!("寫不進去：{e}"))?;
    Ok(FilePath {
        path: target.to_string_lossy().to_string(),
    })
}

/// 稽核軌跡的讀取端回傳值。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogRead {
    /// 所有分片串起來的原文。壞行由前端的 `parseLog` 跳過。
    pub text: String,
    /// 實際讀了哪些分片（檔名，舊到新）。前端要標「資料到哪為止」。
    pub shards: Vec<String>,
    /// 有沒有因為上限而少讀。**不是錯誤，是一個必須說出來的狀態** ——
    /// 少讀的統計會偏低，而畫面若不講，看的人會以為那就是全部。
    pub truncated: bool,
}

/// 一次讀多少個月分片。一年份，足夠所有統計，也讓最壞情況有界。
const MAX_LOG_SHARDS: usize = 12;
/// 總位元組上限。量級推估是每專案每年 20–70 MB，8 MB 涵蓋數個月的高活動期。
const MAX_LOG_BYTES: usize = 8 * 1024 * 1024;

/// 稽核軌跡的讀取端。**唯讀、只認 `<已註冊根>/.anchorline/log/`。**
///
/// 前端傳的是專案根目錄，不是檔案路徑 —— 它不能指定要讀哪個檔。
/// 目錄不存在時回空結果而不是 Err：**沒有開通治理不是錯誤，是一個狀態**，
/// 用 Err 表達會讓畫面跳紅字。
#[tauri::command]
pub async fn read_log(project_root: String, roots: State<'_, RegisteredRoots>) -> R<LogRead> {
    let Some(dir) = paths::log_dir_of(&PathBuf::from(&project_root), &roots) else {
        return Err("這個資料夾沒有被授權過，請用「專案匯入」重新選一次".into());
    };
    let Ok(entries) = fs::read_dir(&dir) else {
        // 還沒有任何事件（或還沒開通治理）。
        return Ok(LogRead {
            text: String::new(),
            shards: Vec::new(),
            truncated: false,
        });
    };

    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("jsonl"))
        .filter_map(|e| e.file_name().to_str().map(|s| s.to_string()))
        .collect();
    // 檔名是 `YYYY-MM.jsonl`，字典序等於時間序。
    names.sort();

    // 取最新的 N 個，但回傳時仍照舊到新 —— 事件的時間順序是前端的預期。
    let truncated_by_count = names.len() > MAX_LOG_SHARDS;
    if truncated_by_count {
        names = names.split_off(names.len() - MAX_LOG_SHARDS);
    }

    let mut text = String::new();
    let mut read: Vec<String> = Vec::new();
    let mut truncated = truncated_by_count;
    for name in names {
        let Ok(chunk) = fs::read_to_string(dir.join(&name)) else {
            continue;
        };
        if text.len() + chunk.len() > MAX_LOG_BYTES {
            truncated = true;
            break;
        }
        text.push_str(&chunk);
        if !text.ends_with('\n') {
            text.push('\n');
        }
        read.push(name);
    }

    Ok(LogRead {
        text,
        shards: read,
        truncated,
    })
}

/// 稽核軌跡的寫入端。**真 O_APPEND**，不是 read-modify-write。
///
/// 三類 writer（App 內動作 / Claude Code hook / git 回填）會併發，
/// 讀整檔再寫回會直接吃掉別人剛寫的事件 —— 而且沒有任何錯誤訊息。
#[tauri::command]
pub fn append_file(path: String, line: String, roots: State<RegisteredRoots>) -> R<FilePath> {
    let p = PathBuf::from(&path);
    if !paths::append_allowed(&p, &roots) {
        return Err("不能追加到這個路徑：必須是已授權專案內的 .anchorline/*.jsonl".into());
    }
    append_line(&p, &line)
}

/// append 的核心。抽出來是為了能測 —— command 拿不到 State 就跑不了單元測試，
/// 而 BRIDGE.md §6 明文要求必須有一條併發案例。
pub fn append_line(p: &Path, line: &str) -> R<FilePath> {
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("建不了目錄：{e}"))?;
        // *.jsonl merge=union：append-only 檔在分支合併時 100% 衝突在檔尾，
        // 而事件自帶時間戳可重排。只在缺檔時種下，不覆寫使用者的設定。
        if let Some(sf) = dir.parent() {
            let attrs = sf.join(".gitattributes");
            if !attrs.exists() {
                let _ = fs::write(&attrs, "*.jsonl merge=union\n");
            }
        }
    }
    let mut f = fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(p)
        .map_err(|e| format!("開不了檔：{e}"))?;
    f.write_all(paths::normalize_line(line).as_bytes())
        .map_err(|e| format!("追加失敗：{e}"))?;
    Ok(FilePath {
        path: p.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn open_path(app: tauri::AppHandle, path: String) -> R<FilePath> {
    use tauri_plugin_opener::OpenerExt;
    let p = PathBuf::from(&path);
    if !paths::editable(&p) {
        return Err("不開這個路徑：必須是家目錄底下的文件檔".into());
    }
    app.opener()
        .open_path(p.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("開不起來：{e}"))?;
    Ok(FilePath {
        path: p.to_string_lossy().to_string(),
    })
}

// ── openspec / gh ────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenspecStatus {
    folder_path: String,
    /// CLI 的原始 JSON 字串。**不在原生端解析**
    list: String,
    statuses: Vec<String>,
}

#[tauri::command]
pub fn openspec_status(
    folder_path: String,
    overrides: State<CliOverrides>,
) -> R<Maybe<OpenspecStatus>> {
    let dir = PathBuf::from(&folder_path);
    let list = match exec::openspec_list(&dir, &overrides) {
        CliResult::Ok(s) => s,
        CliResult::Missing(m) => return Ok(Maybe::Missing(Unavailable::new(m))),
    };
    // 原生端唯一的解析：取出 change 名稱，只為了下一輪查詢。
    // 名字來自 CLI 自己的輸出，不經過前端。
    let names: Vec<String> = serde_json::from_str::<serde_json::Value>(&list)
        .ok()
        .and_then(|v| v.get("changes").cloned())
        .and_then(|c| c.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|c| c.get("name").and_then(|n| n.as_str()).map(String::from))
        .filter(|n| !n.is_empty())
        .collect();

    let statuses = names
        .iter()
        .filter_map(|n| exec::openspec_status(&dir, n, &overrides))
        .collect();

    Ok(Maybe::Ok(OpenspecStatus {
        folder_path,
        list,
        statuses,
    }))
}

/// 未提交的改動內容 —— 給「AI 產生 commit 訊息」用。
///
/// **全部唯讀。** 這裡跑的是 `status --porcelain` 與兩種 `diff`，
/// 沒有任何會改動 repo 的子指令。commit 仍然由使用者自己在終端機執行，
/// 那是 `git-doctor.ts` 立過兩次的界線，這個功能不越過它。
/// 專案快照用的資料夾掃描。
///
/// **副檔名白名單 + 三道上限。** 沒有上限的話，一個帶 node_modules 或
/// build 產物的專案會讓這個呼叫跑到記憶體爆掉，而使用者只會看到 App 卡死。
/// 略過的目錄與二進位檔不是遺漏，是刻意的 —— 快照要餵給模型，
/// 塞進 minified bundle 只會擠掉真正有用的原始碼。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanFile {
    path: String,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScan {
    files: Vec<ScanFile>,
    /// 因為任一道上限而沒讀完。畫面必須講出來
    truncated: bool,
}

/// 檔案數上限。一個 repo 有幾萬個檔的時候，逐檔 read_to_string 會慢到像當機。
const SCAN_MAX_FILES: usize = 4_000;
/// 總量上限 —— **這是記憶體與 IPC 的護欄，不是「檔案太大不要讀」。**
/// 整包會跨過 Tauri 的 IPC 邊界並在前端持有，無上限等於讓一個 repo 就能把 App 打死。
const SCAN_MAX_BYTES: usize = 40_000_000;
// 單檔大小上限已移除（Scott 2026-08-12）：跳過大檔會漏掉真正重要的東西，
// 而「哪個檔重要」不是掃描器判斷得出來的。

fn scan_skip_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules" | ".git" | "target" | "dist" | "build" | ".next" | ".venv"
            | "__pycache__" | "vendor" | ".anchorline" | "coverage" | ".turbo"
    )
}

fn scan_take_ext(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [
        ".ts", ".tsx", ".js", ".jsx", ".rs", ".py", ".go", ".java", ".kt", ".swift",
        ".md", ".mdx", ".txt", ".json", ".yaml", ".yml", ".toml", ".css", ".html", ".sql", ".sh",
    ]
    .iter()
    .any(|e| lower.ends_with(e))
}

fn scan_dir(dir: &Path, root: &Path, out: &mut Vec<ScanFile>, bytes: &mut usize) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    let mut truncated = false;
    for entry in entries.flatten() {
        if out.len() >= SCAN_MAX_FILES || *bytes >= SCAN_MAX_BYTES {
            return true;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') && name != ".github" {
            continue;
        }
        if path.is_dir() {
            if scan_skip_dir(&name) {
                continue;
            }
            truncated |= scan_dir(&path, root, out, bytes);
            continue;
        }
        if !scan_take_ext(&name) {
            continue;
        }
        // 不看檔案大小 —— 只有讀不成 UTF-8 的（二進位）才略過
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        *bytes += text.len();
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();
        out.push(ScanFile { path: rel, text });
    }
    truncated
}

#[tauri::command]
pub fn scan_project(folder_path: String, roots: State<RegisteredRoots>) -> R<Maybe<ProjectScan>> {
    let dir = PathBuf::from(&folder_path);
    if !roots.contains_ancestor_of(&dir) && !roots.contains_ancestor_of(&dir.join("x")) {
        return Ok(Maybe::Missing(Unavailable::new(
            "這個資料夾沒有註冊為專案根目錄".to_string(),
        )));
    }
    let mut files = Vec::new();
    let mut bytes = 0usize;
    let hit_limit = scan_dir(&dir, &dir, &mut files, &mut bytes);
    let truncated = hit_limit || files.len() >= SCAN_MAX_FILES || bytes >= SCAN_MAX_BYTES;
    Ok(Maybe::Ok(ProjectScan { files, truncated }))
}

/// 快照的寫入與列出 —— **只准 `.anchorline/context/` 底下的 `.md`**。
///
/// 檔名由前端給，所以這裡要擋路徑穿越：只取最後一段、拒絕 `..` 與分隔符。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotEntry {
    name: String,
    mtime_ms: f64,
    /// 檔案大小。畫面拿它當「這份報告真的產出來了」的證據 —— 掃描快到
    /// 像是沒執行，只有檔名的話沒有任何東西能證明裡面有內容。
    bytes: f64,
}

fn snapshot_dir(root: &Path) -> PathBuf {
    root.join(".anchorline").join("context")
}

fn safe_snapshot_name(name: &str) -> Option<String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return None;
    }
    if !name.ends_with(".md") || name.len() > 120 {
        return None;
    }
    Some(name.to_string())
}

#[tauri::command]
pub fn list_snapshots(folder_path: String, roots: State<RegisteredRoots>) -> R<Vec<SnapshotEntry>> {
    let dir = PathBuf::from(&folder_path);
    if !roots.contains_ancestor_of(&dir) && !roots.contains_ancestor_of(&dir.join("x")) {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(snapshot_dir(&dir)) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.ends_with(".md") {
                continue;
            }
            let meta = e.metadata().ok();
            let mtime_ms = meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as f64)
                .unwrap_or(0.0);
            let bytes = meta.as_ref().map(|m| m.len() as f64).unwrap_or(0.0);
            out.push(SnapshotEntry {
                name,
                mtime_ms,
                bytes,
            });
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn write_snapshot(
    folder_path: String,
    name: String,
    text: String,
    roots: State<RegisteredRoots>,
) -> R<Maybe<FilePath>> {
    let dir = PathBuf::from(&folder_path);
    if !roots.contains_ancestor_of(&dir) && !roots.contains_ancestor_of(&dir.join("x")) {
        return Ok(Maybe::Missing(Unavailable::new(
            "這個資料夾沒有註冊為專案根目錄".to_string(),
        )));
    }
    let Some(safe) = safe_snapshot_name(&name) else {
        return Ok(Maybe::Missing(Unavailable::new(
            "檔名不合法（只接受 .md，且不能包含路徑）".to_string(),
        )));
    };
    let target_dir = snapshot_dir(&dir);
    if std::fs::create_dir_all(&target_dir).is_err() {
        return Ok(Maybe::Missing(Unavailable::new(
            "無法建立 .anchorline/context/".to_string(),
        )));
    }
    let target = target_dir.join(&safe);
    // 不覆寫 —— 快照是「當時的專案長這樣」，蓋掉就沒有東西可以比對
    if target.exists() {
        return Ok(Maybe::Missing(Unavailable::new(
            "同名快照已存在（同一分鐘內重複產生）".to_string(),
        )));
    }
    match std::fs::write(&target, text) {
        Ok(_) => Ok(Maybe::Ok(FilePath {
            path: target.to_string_lossy().to_string(),
        })),
        Err(e) => Ok(Maybe::Missing(Unavailable::new(format!("寫入失敗：{e}")))),
    }
}

/// 匯出檔（PRD.md / HTML / JSON）寫進 `<root>/.anchorline/exports/`。
///
/// 為什麼不用瀏覽器下載：桌面殼沒有掛 `on_download`，WKWebView 對
/// `<a download>` **無聲失敗** —— 使用者按了匯出，沒有檔案、沒有錯誤、
/// 沒有任何訊息。與其接下載委派讓檔案落進不知道哪裡的「下載項目」，
/// 不如寫進專案自己的 `.anchorline/`，路徑講得出口、跟著專案走。
///
/// 與 `write_snapshot` 的差別：**允許覆寫**。快照是「當時的樣子」，
/// 蓋掉就沒有東西可比；匯出是可重生的成品，同名重匯就是要新的那份。
#[tauri::command]
pub fn write_export(
    folder_path: String,
    name: String,
    text: String,
    roots: State<RegisteredRoots>,
) -> R<Maybe<FilePath>> {
    let dir = PathBuf::from(&folder_path);
    if !roots.contains_ancestor_of(&dir) && !roots.contains_ancestor_of(&dir.join("x")) {
        return Ok(Maybe::Missing(Unavailable::new(
            "這個資料夾沒有註冊為專案根目錄".to_string(),
        )));
    }
    // 沿用快照的檔名規則，但放寬副檔名：匯出有 .md / .html / .json 三種
    if name.contains('/') || name.contains('\\') || name.contains("..") || name.len() > 120 {
        return Ok(Maybe::Missing(Unavailable::new(
            "檔名不合法（不能包含路徑）".to_string(),
        )));
    }
    if !(name.ends_with(".md") || name.ends_with(".html") || name.ends_with(".json")) {
        return Ok(Maybe::Missing(Unavailable::new(
            "只接受 .md / .html / .json".to_string(),
        )));
    }
    let target_dir = dir.join(".anchorline").join("exports");
    if std::fs::create_dir_all(&target_dir).is_err() {
        return Ok(Maybe::Missing(Unavailable::new(
            "無法建立 .anchorline/exports/".to_string(),
        )));
    }
    let target = target_dir.join(&name);
    match std::fs::write(&target, text) {
        Ok(_) => Ok(Maybe::Ok(FilePath {
            path: target.to_string_lossy().to_string(),
        })),
        Err(e) => Ok(Maybe::Missing(Unavailable::new(format!("寫入失敗：{e}")))),
    }
}

/// 這個資料夾有沒有 openspec 骨架。
///
/// 判準是 `openspec/` 目錄存在 —— 不呼叫 CLI，因為「CLI 不在」與
/// 「沒 init 過」是兩件事，混在一起會讓畫面對沒裝 CLI 的人說「請 init」。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenspecProbe {
    initialized: bool,
}

#[tauri::command]
pub fn openspec_probe(folder_path: String) -> R<OpenspecProbe> {
    let dir = PathBuf::from(&folder_path).join("openspec");
    Ok(OpenspecProbe {
        initialized: dir.is_dir(),
    })
}

/// `openspec init` —— **這個 App 唯一會寫入使用者專案的 CLI 呼叫。**
///
/// 界線的例外，理由寫在 `exec::openspec_init`：可逆、不外流、參數寫死。
/// 路徑仍然要過已註冊根目錄的守衛，而且前端要先跟使用者確認。
#[tauri::command]
pub fn openspec_init(
    folder_path: String,
    roots: State<RegisteredRoots>,
    overrides: State<CliOverrides>,
) -> R<Maybe<RawOut>> {
    let dir = PathBuf::from(&folder_path);
    if !roots.contains_ancestor_of(&dir) && !roots.contains_ancestor_of(&dir.join("x")) {
        return Ok(Maybe::Missing(Unavailable::new(
            "這個資料夾沒有註冊為專案根目錄".to_string(),
        )));
    }
    match exec::openspec_init(&dir, &overrides) {
        CliResult::Ok(raw) => Ok(Maybe::Ok(RawOut { raw })),
        CliResult::Missing(m) => Ok(Maybe::Missing(Unavailable::new(m))),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangeset {
    status: String,
    stat: String,
    patch: String,
    /// patch 是否因為超過上限被截斷。前端要把這件事顯示出來 ——
    /// 截斷過的 diff 產出的訊息比較粗，使用者有權知道
    truncated: bool,
}

/// patch 的位元組上限。
///
/// 上限的第二個理由比第一個重要：超過的部分會被送到外部 AI 服務。
/// 截斷是使用者看得到的降級，靜靜把整份 diff 寄出去不是。
const PATCH_LIMIT: usize = 24_000;

#[tauri::command]
pub fn git_changeset(
    folder_path: String,
    roots: State<RegisteredRoots>,
    overrides: State<CliOverrides>,
) -> R<Maybe<GitChangeset>> {
    let dir = PathBuf::from(&folder_path);
    // 只讀已註冊的專案根目錄，跟 append_file 同一道守衛
    if !roots.contains_ancestor_of(&dir) && !roots.contains_ancestor_of(&dir.join("x")) {
        return Ok(Maybe::Missing(Unavailable::new(
            "這個資料夾沒有註冊為專案根目錄".to_string(),
        )));
    }
    let Some(status) = exec::git(&dir, &["status", "--porcelain"], &overrides) else {
        return Ok(Maybe::Missing(Unavailable::new(
            "這個資料夾不是 git 專案，或找不到 git".to_string(),
        )));
    };
    let stat = exec::git(&dir, &["diff", "HEAD", "--stat"], &overrides).unwrap_or_default();
    let raw = exec::git(&dir, &["diff", "HEAD", "--unified=1"], &overrides).unwrap_or_default();
    let truncated = raw.len() > PATCH_LIMIT;
    // 截在字元邊界上，切一半的 UTF-8 會讓整個 JSON 序列化壞掉
    let patch = if truncated {
        let mut cut = PATCH_LIMIT;
        while cut > 0 && !raw.is_char_boundary(cut) {
            cut -= 1;
        }
        raw[..cut].to_string()
    } else {
        raw
    };

    Ok(Maybe::Ok(GitChangeset {
        status,
        stat,
        patch,
        truncated,
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhStatus {
    raw: String,
    /// 前端靠這個標新鮮度。網路資料不標新鮮度，使用者會以為是即時的
    fetched_at: String,
}

#[tauri::command]
pub fn gh_status(overrides: State<CliOverrides>) -> R<Maybe<GhStatus>> {
    match exec::gh_search_prs(&overrides) {
        CliResult::Ok(raw) => Ok(Maybe::Ok(GhStatus {
            raw,
            fetched_at: now_iso(),
        })),
        CliResult::Missing(m) => Ok(Maybe::Missing(Unavailable::new(m))),
    }
}

fn now_iso() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = d.as_secs() as i64;
    let days = secs / 86400;
    let rem = secs % 86400;
    let (y, mo, da) = civil_from_days(days);
    format!(
        "{y:04}-{mo:02}-{da:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Howard Hinnant 的 civil_from_days。避免為了一個時間戳拉 chrono 進來。
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

// ── 裝飾 / 探測 ──────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOut {
    raw: String,
}

#[tauri::command]
pub fn onefetch(folder_path: String, overrides: State<CliOverrides>) -> R<Maybe<RawOut>> {
    match exec::onefetch(&PathBuf::from(&folder_path), &overrides) {
        Some(raw) => Ok(Maybe::Ok(RawOut { raw })),
        None => Ok(Maybe::Missing(Unavailable::new(
            "找不到 onefetch，或這不是 git 專案。可用 brew install onefetch 安裝。",
        ))),
    }
}

#[tauri::command]
pub fn fastfetch(overrides: State<CliOverrides>) -> R<Maybe<RawOut>> {
    match exec::fastfetch(&overrides) {
        Some(raw) => Ok(Maybe::Ok(RawOut { raw })),
        None => Ok(Maybe::Missing(Unavailable::new(
            "找不到 fastfetch。可用 brew install fastfetch 安裝。",
        ))),
    }
}

/// 使用者在設定裡指定 CLI 路徑。探測順序的第一步（`docs/BRIDGE.md` §5）。
#[tauri::command]
pub fn set_cli_path(tool: String, path: Option<String>, overrides: State<CliOverrides>) -> R<bool> {
    const ALLOWED: &[&str] = &["git", "openspec", "gh", "onefetch", "fastfetch"];
    if !ALLOWED.contains(&tool.as_str()) {
        return Err(format!("不認識的工具：{tool}"));
    }
    let p = path.map(PathBuf::from);
    if let Some(ref pp) = p {
        if !pp.is_file() {
            return Err("那個路徑不是一個檔案".into());
        }
    }
    overrides.set(&tool, p);
    Ok(true)
}

/// 哪些 CLI 現在找得到。給設定頁顯示，也給前端做功能偵測。
#[tauri::command]
pub fn probe_clis(overrides: State<CliOverrides>) -> R<serde_json::Value> {
    let mut out = serde_json::Map::new();
    for t in ["git", "openspec", "gh", "onefetch", "fastfetch"] {
        out.insert(
            t.into(),
            match exec::locate(t, &overrides) {
                Some(p) => serde_json::json!(p.to_string_lossy()),
                None => serde_json::Value::Null,
            },
        );
    }
    Ok(serde_json::Value::Object(out))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pong {
    native: bool,
    capabilities: Vec<String>,
}

/// **實際實作了哪些 action。** 前端靠它做功能偵測，而不是靠版本號猜。
#[tauri::command]
pub fn ping() -> R<Pong> {
    Ok(Pong {
        native: true,
        capabilities: [
            "pickFolder",
            "pickProjectFolder",
            "projectStats",
            "trackingScan",
            "readFile",
            "writeFile",
            "appendFile",
            "readLog",
            "openPath",
            "openspecStatus",
            "ghStatus",
            "onefetch",
            "fastfetch",
            "setCliPath",
            "probeClis",
            "uatHandoffTake",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect(),
    })
}
