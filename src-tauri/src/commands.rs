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
pub async fn tracking_scan(plans_dirs: Vec<String>) -> R<TrackingScan> {
    Ok(scan_plans(&plans_dirs))
}

pub fn scan_plans(plans_dirs: &[String]) -> TrackingScan {
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
            });
        }
    }

    let sp = signal_path();
    let signal = match (fs::read_to_string(&sp), mtime_ms(&sp)) {
        (Ok(raw), Some(ms)) => Some(TrackingSignal { raw, mtime_ms: ms }),
        // 檔不存在／權限／讀壞 —— 全部不是錯誤，是「退回段 2」
        _ => None,
    };

    TrackingScan { files, signal }
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
        return Err("不能存取這個路徑：必須是家目錄底下既有的文件檔".into());
    }
    let text = fs::read_to_string(&p).map_err(|e| format!("讀不到檔案：{e}"))?;
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
            "openPath",
            "openspecStatus",
            "ghStatus",
            "onefetch",
            "fastfetch",
            "setCliPath",
            "probeClis",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect(),
    })
}
