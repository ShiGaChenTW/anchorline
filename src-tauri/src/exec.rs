//! 外部程式呼叫 —— 參數一律在這裡寫死，前端永遠碰不到。
//!
//! 這就是不引入 `tauri-plugin-shell` 的原因：那個 plugin 讓前端呼叫 shell，
//! 即使配 allowlist，參數仍然由前端組。這裡的每個函式只收「工作目錄」和
//! 已列舉的選項，指令與旗標是常數。見 `docs/BRIDGE.md` §3.1。
//!
//! CLI 探測（§5）解的是一個很具體的問題：GUI 進程繼承的 PATH 通常不含
//! Homebrew 或 npm global，而 `openspec` 是 npm global 裝的 Node CLI。

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

/// 使用者在設定裡指定的 CLI 絕對路徑。**探測順序的第一步，也是最終逃生口。**
///
/// 任何猜路徑的邏輯都會漏掉某個人的環境；給他一個輸入框比多猜十個路徑有用。
#[derive(Default)]
pub struct CliOverrides(pub Mutex<std::collections::HashMap<String, PathBuf>>);

impl CliOverrides {
    pub fn set(&self, tool: &str, path: Option<PathBuf>) {
        if let Ok(mut m) = self.0.lock() {
            match path {
                Some(p) => m.insert(tool.to_string(), p),
                None => m.remove(tool),
            };
        }
    }
    fn get(&self, tool: &str) -> Option<PathBuf> {
        self.0.lock().ok().and_then(|m| m.get(tool).cloned())
    }
}

/// 常見安裝點。三平台各一組。
fn candidate_dirs() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = Vec::new();
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from);

    if cfg!(target_os = "windows") {
        for key in ["APPDATA", "LOCALAPPDATA"] {
            if let Some(base) = std::env::var_os(key).map(PathBuf::from) {
                v.push(base.join("npm"));
            }
        }
        if let Some(h) = &home {
            v.push(h.join(".bun/bin"));
            v.push(h.join("scoop/shims"));
        }
    } else {
        v.push(PathBuf::from("/opt/homebrew/bin"));
        v.push(PathBuf::from("/usr/local/bin"));
        v.push(PathBuf::from("/usr/bin"));
        if let Some(h) = &home {
            v.push(h.join(".local/bin"));
            v.push(h.join(".npm-global/bin"));
            v.push(h.join(".bun/bin"));
            v.push(h.join(".volta/bin"));
            // nvm / asdf 是版本化目錄，逐一列舉不切實際 —— 交給 PATH 或使用者指定
        }
    }
    v
}

/// Windows 上一個「指令」可能是好幾種副檔名的檔案。
///
/// **這裡原本只試 `.cmd`，那是個真 bug**：`.cmd` 是 npm global 裝出來的 shim
/// （`openspec.cmd`），而原生二進位是 `.exe`（`git.exe` / `gh.exe`）。
/// 只試一種等於在 Windows 上永遠找不到 git 與 gh —— 而那兩個是必要依賴。
///
/// 抓到它的是三平台 CI 的 `locate_finds_a_universally_present_binary`
/// （macOS/Linux 找 `sh`、Windows 找 `cmd`）。在 macOS 上跑一萬次都不會紅。
///
/// 順序照 `PATHEXT`（Windows 自己的優先序），拿不到就退回常見的三種。
/// 最後補一個裸名，因為使用者在設定裡指定的路徑可能沒有副檔名。
fn exe_candidates(tool: &str) -> Vec<String> {
    if !cfg!(target_os = "windows") {
        return vec![tool.to_string()];
    }
    let pathext = std::env::var("PATHEXT").unwrap_or_default();
    let mut exts: Vec<String> = pathext
        .split(';')
        .map(|e| e.trim().to_ascii_lowercase())
        .filter(|e| e.starts_with('.'))
        .collect();
    if exts.is_empty() {
        exts = vec![".exe".into(), ".cmd".into(), ".bat".into()];
    }
    let mut v: Vec<String> = exts.iter().map(|e| format!("{tool}{e}")).collect();
    v.push(tool.to_string());
    v
}

/// 找一個 CLI。順序見 `docs/BRIDGE.md` §5。
pub fn locate(tool: &str, overrides: &CliOverrides) -> Option<PathBuf> {
    // 1. 使用者指定
    if let Some(p) = overrides.get(tool) {
        if p.is_file() {
            return Some(p);
        }
    }
    // 2. PATH
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            for name in exe_candidates(tool) {
                let c = dir.join(&name);
                if c.is_file() {
                    return Some(c);
                }
            }
        }
    }
    // 3. 常見安裝點
    for dir in candidate_dirs() {
        for name in exe_candidates(tool) {
            let c = dir.join(&name);
            if c.is_file() {
                return Some(c);
            }
        }
    }
    None
}

fn run(bin: &Path, args: &[&str], cwd: Option<&Path>) -> Option<String> {
    let mut cmd = Command::new(bin);
    cmd.args(args);
    if let Some(d) = cwd {
        cmd.current_dir(d);
    }
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8(out.stdout).ok()
}

// ── git ─────────────────────────────────────────────────────────────

/// 只跑寫死的唯讀 git 子指令，資料夾當工作目錄傳入。
///
/// 非 git 專案回 `None`，**不是錯誤** —— 呼叫端把 git 欄位留空即可。
/// 寫入走旁邊的 `git_init`，不要從這裡接 `commit` / `push`。
pub fn git(dir: &Path, args: &[&str], overrides: &CliOverrides) -> Option<String> {
    let bin = locate("git", overrides)?;
    let mut full: Vec<&str> = vec!["-C"];
    let dir_s = dir.to_str()?;
    full.push(dir_s);
    full.extend_from_slice(args);
    run(&bin, &full, None).map(|s| s.trim_end().to_string())
}

pub enum CliResult {
    Ok(String),
    Missing(String),
}

/// `git init` —— 與 `openspec_init` 同一類例外：可逆、不外流、參數寫死。
///
/// 不順便 add / commit：那會替使用者寫下一筆他沒看過的提交。
/// 已經在 git work tree 裡就回 Missing，不重跑——`git init` 對既有 repo
/// 是 no-op 成功，畫面會以為「按了沒反應」。
pub fn git_init(dir: &Path, overrides: &CliOverrides) -> CliResult {
    let Some(bin) = locate("git", overrides) else {
        return CliResult::Missing(
            "找不到 git。安裝：brew install git，或在設定裡指定路徑。".into(),
        );
    };
    let Some(dir_s) = dir.to_str() else {
        return CliResult::Missing("專案路徑不是有效的 UTF-8".into());
    };
    if git(dir, &["rev-parse", "--is-inside-work-tree"], overrides)
        .map(|s| s.trim() == "true")
        .unwrap_or(false)
    {
        return CliResult::Missing("這個資料夾已經是 git 專案".into());
    }
    match run(&bin, &["-C", dir_s, "init"], None) {
        Some(out) => CliResult::Ok(out),
        None => CliResult::Missing("git init 執行失敗".into()),
    }
}

// ── openspec ────────────────────────────────────────────────────────

pub fn openspec_list(dir: &Path, overrides: &CliOverrides) -> CliResult {
    match locate("openspec", overrides) {
        Some(bin) => match run(&bin, &["list", "--json"], Some(dir)) {
            Some(s) => CliResult::Ok(s),
            None => CliResult::Missing("openspec 執行失敗，或這不是 openspec 專案。".into()),
        },
        None => CliResult::Missing(
            "找不到 openspec。安裝：npm i -g @fission-ai/openspec，或在設定裡指定路徑。".into(),
        ),
    }
}

/// `openspec init` —— 寫入例外，理由與 `git_init` 相同：可逆、不外流、參數寫死。
/// 建立 `openspec/` 骨架，刪掉資料夾就還原。呼叫端仍然要先跟使用者確認。
/// 抽成常數是為了能被測試盯住。少了 `--tools`，這顆按鈕會靜默地什麼都不做。
pub const OPENSPEC_INIT_ARGS: [&str; 3] = ["init", "--tools", "claude"];

pub fn openspec_init(dir: &Path, overrides: &CliOverrides) -> CliResult {
    match locate("openspec", overrides) {
        // `--tools claude` 不能省。裸的 `openspec init` 是**互動式**的，會問要設定
        // 哪些 AI 工具；從 GUI 起的行程沒有 TTY，於是它直接 exit 1 印
        // 「Use --tools all, --tools none, or --tools claude,cursor,...」，
        // 什麼都不建立。實測過（2026-08-22）：舊版這顆按鈕從來沒有成功過，
        // 而使用者看到的只有一句「openspec init 執行失敗」。
        //
        // 帶上 claude 之後它會一次建好兩邊：`openspec/`（changes + specs +
        // config.yaml）與 `.claude/skills/openspec-*` ＋ `.claude/commands/opsx`。
        // 後者就是「OpenSpec 的 skill」——它是**每個專案各一份**，不是全域裝一次。
        Some(bin) => match run(&bin, &OPENSPEC_INIT_ARGS, Some(dir)) {
            Some(out) => CliResult::Ok(out),
            None => CliResult::Missing(
                "openspec init 執行失敗。這個資料夾可能已經初始化過，或 openspec 版本太舊（--tools 需要 1.x）。".to_string(),
            ),
        },
        None => CliResult::Missing(
            "找不到 openspec。安裝：npm i -g @fission-ai/openspec，或在設定裡指定路徑。".into(),
        ),
    }
}

/// `status --change <name>`。
///
/// **`name` 只能來自 `list --json` 自己的輸出**，不經過前端 —— 呼叫端負責保證。
pub fn openspec_status(dir: &Path, name: &str, overrides: &CliOverrides) -> Option<String> {
    let bin = locate("openspec", overrides)?;
    run(&bin, &["status", "--change", name, "--json"], Some(dir))
}

// ── gh ──────────────────────────────────────────────────────────────

/// 跨 repo 的 open PR。**永遠只有 search，不會出現任何寫入子指令。**
pub fn gh_search_prs(overrides: &CliOverrides) -> CliResult {
    match locate("gh", overrides) {
        Some(bin) => match run(
            &bin,
            &[
                "search",
                "prs",
                "--author=@me",
                "--state=open",
                "--limit",
                "30",
                "--json",
                "repository,number,title,updatedAt",
            ],
            None,
        ) {
            Some(s) => CliResult::Ok(s),
            None => CliResult::Missing("gh 執行失敗，可能尚未登入（gh auth login）。".into()),
        },
        None => CliResult::Missing("找不到 gh。安裝：brew install gh，或在設定裡指定路徑。".into()),
    }
}

// ── 裝飾用（歡迎畫面）───────────────────────────────────────────────

pub fn onefetch(dir: &Path, overrides: &CliOverrides) -> Option<String> {
    let bin = locate("onefetch", overrides)?;
    run(&bin, &["--output", "json"], Some(dir))
}

pub fn fastfetch(overrides: &CliOverrides) -> Option<String> {
    let bin = locate("fastfetch", overrides)?;
    let raw = run(&bin, &["--logo", "none", "--format", "json"], None)?;
    Some(strip_ansi(&raw))
}

/// fastfetch 前後夾 ANSI 跳脫序列，而序列本身含 `[`。
/// **要先整段剝掉再找 JSON 開頭**，直接 parse 會炸在第一個字元。
pub fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                while let Some(&n) = chars.peek() {
                    chars.next();
                    if n.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    match out.find('[') {
        Some(i) => out[i..].to_string(),
        None => out,
    }
}

#[cfg(test)]
mod tests {
    /// `openspec init` 沒有 `--tools` 就是互動式的，而 GUI 起的行程沒有 TTY：
    /// 它 exit 1 印一行 usage，什麼都不建立，使用者只看到「執行失敗」。
    /// 實測過 2026-08-22（openspec 1.6.0）。這一題守的是「有人覺得參數多餘」。
    #[test]
    fn openspec_init_is_non_interactive() {
        assert!(
            OPENSPEC_INIT_ARGS.contains(&"--tools"),
            "少了 --tools 會讓 openspec init 進互動模式而靜默失敗"
        );
        assert!(
            OPENSPEC_INIT_ARGS.contains(&"claude"),
            "要裝的是 .claude/skills/openspec-*，工具名不能漏"
        );
    }

    use super::*;

    #[test]
    fn strip_ansi_finds_json_start() {
        let raw = "\u{1b}[m\u{1b}[?7l[{\"a\":1}]\u{1b}[0m";
        assert_eq!(strip_ansi(raw), "[{\"a\":1}]");
    }

    #[test]
    fn strip_ansi_is_noop_on_clean_json() {
        assert_eq!(strip_ansi("[{\"a\":1}]"), "[{\"a\":1}]");
    }

    #[test]
    fn locate_finds_a_universally_present_binary() {
        let o = CliOverrides::default();
        let tool = if cfg!(target_os = "windows") {
            "cmd"
        } else {
            "sh"
        };
        assert!(locate(tool, &o).is_some(), "PATH 探測壞了");
    }

    /// 這條守的是「Windows 上只試 .cmd」那個 bug。
    /// `.cmd` 是 npm shim，`.exe` 是原生二進位 —— 少一個就少一半的工具。
    #[test]
    fn exe_candidates_covers_exe_and_cmd_on_windows() {
        let c = exe_candidates("git");
        if cfg!(target_os = "windows") {
            assert!(
                c.iter().any(|x| x == "git.exe"),
                "漏了 .exe：git/gh 會找不到"
            );
            assert!(
                c.iter().any(|x| x == "git.cmd"),
                "漏了 .cmd：npm global 會找不到"
            );
            assert!(
                c.iter().any(|x| x == "git"),
                "漏了裸名：使用者指定的路徑可能沒副檔名"
            );
        } else {
            assert_eq!(c, vec!["git".to_string()]);
        }
    }

    #[test]
    fn locate_returns_none_for_nonsense() {
        let o = CliOverrides::default();
        assert!(locate("definitely-not-a-real-binary-xyz", &o).is_none());
    }
}
