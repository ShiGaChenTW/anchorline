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

// ── agent CLI ───────────────────────────────────────────────────────
//
// 這一段是 `docs/BRIDGE.md` §3.3 新契約的實作：**禁的是任意「指令」，
// 允許的是「把一段文字從 stdin 餵給白名單內、旗標寫死的 CLI」。**
//
// 前端能決定的只有兩件事：`tool`（下面這張表的 id，列舉）與 prompt 內容。
// 旗標、子指令、環境變數全部是這裡的常數 —— 前端一個字都插不進 argv。
//
// **每個工具的旗標都是實測出來的，不是照文件抄的。** 兩個實測踩到的坑：
//   - grok 的 `--tools ""` 看起來像「空白名單」，實際上是 no-op：帶著它
//     問「讀 secret.txt」照樣把檔案內容吐回來。真正擋得住的是 `--deny '*'`。
//   - `--disallowed-tools 'Bash,Read,…'` 同樣沒擋住 —— grok 的內建工具名
//     跟 Claude 那套不一樣，名字對不上就等於沒設。
// 這就是「不准憑印象寫旗標」的理由：兩個都是**靜默失效**，沒有錯誤訊息。

/// 逾時。LLM CLI 動輒數十秒，但**沒有上限就是把 App 凍住**。
pub const AGENT_TIMEOUT_SECS: u64 = 180;
/// stdout 上限。超出截斷並標示 —— 靜靜給一份短少的輸出比報錯更糟。
pub const AGENT_MAX_STDOUT: usize = 1024 * 1024;
/// prompt 上限。它要跨 IPC 再進管線，無上限等於一個呼叫就能吃掉記憶體。
pub const AGENT_MAX_PROMPT: usize = 256 * 1024;

/// 白名單裡的一個 agent CLI。**`args` / `envs` 是常數，前端碰不到。**
pub struct AgentTool {
    pub id: &'static str,
    pub bin: &'static str,
    pub args: &'static [&'static str],
    pub envs: &'static [(&'static str, &'static str)],
    /// 沒裝時給使用者看的安裝提示（走 unavailable，不是錯誤）。
    pub install: &'static str,
    /// 這個工具「工具被禁掉」靠的是哪個旗標。**只有測試在讀它**，
    /// 而那正是重點：它存在是為了讓「順手刪掉一個旗標」變成紅燈。
    #[cfg_attr(not(test), allow(dead_code))]
    pub lockdown: &'static str,
}

/// 白名單。**四個，不是六個。**
///
/// `codex` 與 `hermes` 實測後排除，理由見 `docs/BRIDGE.md` §3.1 底下那段：
/// 兩者在各自最嚴格的非互動模式下**仍然讀得到任意檔案並把內容回傳**，
/// 那等於給 WebView 開一條檔案外洩通道，D1 把 prompt 擋在 argv 外就白守了。
pub const AGENT_TOOLS: &[AgentTool] = &[
    // `--tools ""` 是官方文件寫明的「停用全部工具」。實測：要求它跑
    // `touch pwned.txt` 時它「宣稱」跑了並印出假的 ls 輸出，但檔案根本
    // 沒被建立 —— 模型在幻覺，工具層沒有執行。這是它該有的樣子。
    // `--safe-mode` 再把 CLAUDE.md／skills／hooks／MCP 全關掉（auth 不受影響）。
    AgentTool {
        id: "claude",
        bin: "claude",
        args: &[
            "-p",
            "--tools",
            "",
            "--output-format",
            "text",
            "--strict-mcp-config",
            "--no-session-persistence",
            "--safe-mode",
        ],
        envs: &[],
        install: "找不到 claude。安裝見 claude.ai/code，或在設定裡指定路徑。",
        lockdown: "--tools",
    },
    // grok 沒有「從 stdin 讀 prompt」的旗標，`-p/--single` 要把 prompt 放進
    // argv —— 那違反 D1。`--prompt-file /dev/stdin` 是唯一走得通的路：
    // 路徑本身是常數，prompt 仍然只從管線進去。
    // 擋工具的是 `--deny '*'`（實測會回「Every tool call in this session is
    // blocked by a deny rule that matches all tools」）。
    AgentTool {
        id: "grok",
        bin: "grok",
        args: &[
            "--prompt-file",
            "/dev/stdin",
            "--deny",
            "*",
            "--output-format",
            "plain",
            "--no-subagents",
            "--disable-web-search",
        ],
        envs: &[],
        install: "找不到 grok。安裝見 grok CLI 官方說明，或在設定裡指定路徑。",
        lockdown: "--deny",
    },
    // `--no-tools` 是六個裡語意最乾淨的一個：實測它直接回
    // 「I don't have any file-reading tools available right now」。
    AgentTool {
        id: "pi",
        bin: "pi",
        args: &[
            "-p",
            "--no-tools",
            "--no-session",
            "--no-extensions",
            "--no-skills",
            "--no-context-files",
            "--mode",
            "text",
        ],
        envs: &[],
        install: "找不到 pi。安裝：npm i -g @earendil-works/pi-coding-agent，或在設定裡指定路徑。",
        lockdown: "--no-tools",
    },
    // agy 沒有「停用工具」的旗標，靠的是**headless 模式問不了人就自動拒絕**：
    // 實測回「a tool required the "command" permission that headless mode
    // cannot prompt for, so it was auto-denied」。這是 fail-closed 的預設值，
    // 但它是**預設值不是鎖**：使用者若在 settings.json 加 permissions.allow
    // 就會被放行。四個裡面只有這個的守門不在我們手上，BRIDGE.md §3.1 有記。
    // 注意 `--print` 是吃值的旗標，帶了它 prompt 就進 argv；不帶才走 stdin。
    AgentTool {
        id: "agy",
        bin: "agy",
        args: &[
            "--output-format",
            "text",
            "--disable-slash-commands",
            "--sandbox",
        ],
        envs: &[],
        install: "找不到 agy。安裝見 agy CLI 官方說明，或在設定裡指定路徑。",
        lockdown: "--sandbox",
    },
];

pub fn agent_tool(id: &str) -> Option<&'static AgentTool> {
    AGENT_TOOLS.iter().find(|t| t.id == id)
}

pub struct AgentOut {
    pub text: String,
    pub truncated: bool,
}

/// 三種結局刻意分開：**沒裝**是狀態（走 unavailable），逾時與非零離開才是錯誤。
pub enum AgentRun {
    Ok(AgentOut),
    NotInstalled(String),
    Failed(String),
}

/// 把讀到的 bytes 收在 UTF-8 字元邊界上。切一半會讓序列化壞掉（§4.7b 同一條）。
fn utf8_trim(b: &[u8]) -> String {
    let mut end = b.len();
    // 一個 UTF-8 字元最多 4 bytes，所以最多往回退 3 個
    for _ in 0..4 {
        if std::str::from_utf8(&b[..end]).is_ok() {
            break;
        }
        if end == 0 {
            break;
        }
        end -= 1;
    }
    String::from_utf8_lossy(&b[..end]).into_owned()
}

/// 讀到上限為止，**但超過上限之後仍然要繼續把管線抽乾**。
///
/// 不抽乾的話子程序會卡在 write 上，症狀會變成「每次都逾時」而不是
/// 「輸出被截斷」—— 兩者的畫面訊息完全不同，會把人帶去查錯方向。
fn read_capped<R: std::io::Read>(mut r: R, max: usize) -> (Vec<u8>, bool) {
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 8192];
    let mut truncated = false;
    loop {
        match r.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                if buf.len() < max {
                    let take = (max - buf.len()).min(n);
                    buf.extend_from_slice(&chunk[..take]);
                    if take < n {
                        truncated = true;
                    }
                } else {
                    truncated = true;
                }
            }
            Err(_) => break,
        }
    }
    (buf, truncated)
}

/// 餵 stdin、限時、限量地跑一個外部程式。
///
/// 現有的 `run()` 是同步 `cmd.output()` 而且沒有逾時 —— 對 git 夠用，
/// 對動輒數分鐘的 LLM CLI 會把整個 App 凍住。這個函式是給後者的。
///
/// **三件事都必須在不同執行緒上做**：寫 stdin、讀 stdout、讀 stderr。
/// 在同一條執行緒上依序做會死鎖 —— 子程序要等我們讀走 stdout 才會繼續
/// 讀 stdin，而我們在等它收完 stdin 才去讀 stdout。
///
/// 逾時用 `try_wait()` 輪詢而不是 `wait_with_output()`：後者會吃掉 `Child`，
/// 吃掉之後就 **kill 不動了**，逾時也只能乾等。
pub fn run_stdin(
    bin: &Path,
    args: &[&str],
    envs: &[(&str, &str)],
    stdin_text: &str,
    timeout: std::time::Duration,
    max_bytes: usize,
) -> Result<AgentOut, String> {
    use std::io::Write;
    use std::process::Stdio;

    let mut cmd = Command::new(bin);
    cmd.args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in envs {
        cmd.env(k, v);
    }

    let mut child = cmd.spawn().map_err(|e| format!("啟動失敗：{e}"))?;

    if let Some(mut si) = child.stdin.take() {
        let data = stdin_text.as_bytes().to_vec();
        std::thread::spawn(move || {
            let _ = si.write_all(&data);
            // drop 關掉管線就是送 EOF。少了它，CLI 會一直等更多輸入，
            // 而我們只會看到「逾時」——完全看不出真正的原因。
        });
    }

    let out_h = child
        .stdout
        .take()
        .map(|so| std::thread::spawn(move || read_capped(so, max_bytes)));
    let err_h = child
        .stderr
        .take()
        .map(|se| std::thread::spawn(move || read_capped(se, 64 * 1024)));

    let start = std::time::Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    // 一定要 wait 收屍，否則留下 zombie
                    let _ = child.wait();
                    break None;
                }
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            Err(e) => return Err(format!("等待子程序失敗：{e}")),
        }
    };

    let (obuf, otrunc) = out_h
        .and_then(|h| h.join().ok())
        .unwrap_or((Vec::new(), false));
    let (ebuf, _) = err_h
        .and_then(|h| h.join().ok())
        .unwrap_or((Vec::new(), false));

    let Some(status) = status else {
        return Err(format!("超過 {} 秒沒有結果，已中止。", timeout.as_secs()));
    };
    if !status.success() {
        let se = utf8_trim(&ebuf);
        let tail = se.trim();
        let tail = if tail.is_empty() {
            String::new()
        } else {
            format!("：{}", tail.chars().take(400).collect::<String>())
        };
        return Err(format!("執行失敗（exit {:?}）{tail}", status.code()));
    }
    Ok(AgentOut {
        text: utf8_trim(&obuf),
        truncated: otrunc,
    })
}

/// 白名單內的一個 agent CLI，prompt 走 stdin。見 `docs/BRIDGE.md` §4.11。
pub fn agent_cli(spec: &AgentTool, prompt: &str, overrides: &CliOverrides) -> AgentRun {
    let Some(bin) = locate(spec.bin, overrides) else {
        return AgentRun::NotInstalled(spec.install.to_string());
    };
    match run_stdin(
        &bin,
        spec.args,
        spec.envs,
        prompt,
        std::time::Duration::from_secs(AGENT_TIMEOUT_SECS),
        AGENT_MAX_STDOUT,
    ) {
        Ok(o) => AgentRun::Ok(o),
        Err(e) => AgentRun::Failed(e),
    }
}

#[cfg(test)]
mod agent_tests {
    use super::*;
    use std::time::Duration;

    /// 白名單就是白名單。認不得的名字**不可以**回一個能跑的東西。
    #[test]
    fn agent_whitelist_rejects_unknown() {
        assert!(agent_tool("claude").is_some());
        assert!(agent_tool("definitely-not-a-tool").is_none());
        // 實測排除的兩個，不准偷偷回來
        assert!(
            agent_tool("codex").is_none(),
            "codex 實測會執行 shell 並讀走任意檔案，不能進白名單"
        );
        assert!(
            agent_tool("hermes").is_none(),
            "hermes 實測 --safe-mode -t \"\" 仍然讀得到任意檔案"
        );
    }

    /// 每個工具都必須帶著它那個**實測驗證過**的禁工具旗標。
    ///
    /// 這條守的是「有人覺得參數太長順手刪一個」。刪掉之後不會有任何錯誤，
    /// 只會安靜地讓 WebView 多一條任意檔案讀取路徑。
    #[test]
    fn every_agent_tool_keeps_its_lockdown_flag() {
        for t in AGENT_TOOLS {
            assert!(
                t.args.contains(&t.lockdown),
                "{} 少了禁工具旗標 {}",
                t.id,
                t.lockdown
            );
        }
    }

    /// prompt 永遠不進 argv（D1）。argv 裡不該出現任何看起來像句子的東西。
    #[test]
    fn agent_args_are_constants_not_prompts() {
        for t in AGENT_TOOLS {
            for a in t.args {
                assert!(
                    a.len() < 32,
                    "{} 的 argv 出現了過長的字串 {a:?} —— prompt 應該只走 stdin",
                    t.id
                );
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn run_stdin_feeds_the_child() {
        let out = run_stdin(
            Path::new("/bin/sh"),
            &["-c", "cat"],
            &[],
            "hello-from-stdin",
            Duration::from_secs(10),
            1024,
        )
        .expect("cat 應該成功");
        assert_eq!(out.text, "hello-from-stdin");
        assert!(!out.truncated);
    }

    /// 逾時要**真的把子程序殺掉**，而且要真的在時限附近回來。
    /// 只回一個錯誤但讓 sleep 30 跑完，等於沒有逾時。
    #[cfg(unix)]
    #[test]
    fn run_stdin_kills_on_timeout() {
        let start = std::time::Instant::now();
        let r = run_stdin(
            Path::new("/bin/sh"),
            &["-c", "sleep 30"],
            &[],
            "",
            Duration::from_millis(300),
            1024,
        );
        let took = start.elapsed();
        assert!(r.is_err(), "逾時應該回 Err");
        assert!(
            took < Duration::from_secs(10),
            "逾時沒有真的 kill，等了 {took:?}"
        );
    }

    /// 超過上限要截斷**並且標示**。而且要能正常結束 ——
    /// 截斷之後不繼續抽乾管線的話，這條測試會變成逾時而不是截斷。
    #[cfg(unix)]
    #[test]
    fn run_stdin_truncates_and_flags() {
        let out = run_stdin(
            Path::new("/bin/sh"),
            &["-c", "yes abcdefghij | head -n 5000"],
            &[],
            "",
            Duration::from_secs(20),
            100,
        )
        .expect("應該成功而不是逾時");
        assert_eq!(out.text.len(), 100, "沒有截到上限");
        assert!(out.truncated, "截斷了卻沒有標示");
    }

    /// 截斷點落在 UTF-8 邊界上，不會切出半個字。
    #[test]
    fn utf8_trim_lands_on_char_boundary() {
        let s = "中文字";
        // 「中」是 3 bytes，砍在第 4 個 byte 等於切開「文」
        assert_eq!(utf8_trim(&s.as_bytes()[..4]), "中");
        assert_eq!(utf8_trim(s.as_bytes()), "中文字");
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
