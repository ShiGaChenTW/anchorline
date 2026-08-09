//! 路徑守門 —— 前端能送任意字串進來，這裡是唯一的關口。
//!
//! **兩條謂詞刻意不共用**（見 `docs/BRIDGE.md` §3.2）：
//!
//! - [`editable`] 管「改一個使用者點開過的既有檔」
//! - [`append_allowed`] 管「在專案裡建立並持續追加一份稽核軌跡」
//!
//! 後者會建新檔，所以規則更緊。把兩者合併成一條「通用的安全路徑檢查」是很自然的
//! 重構衝動，但那會讓 append 的嚴格度悄悄降到 editable 的水準 —— 而降級不會有
//! 任何測試失敗，只會多出一個可以在家目錄任何地方建 .jsonl 的能力。

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 使用者透過系統資料夾選擇器親手選過的專案根目錄。
///
/// **這是 [`append_allowed`] 唯一的授權來源。** 前端傳來的路徑只能被檢查，
/// 不能被信任成根目錄 —— 否則「限制在專案內」就等於「限制在前端說的專案內」，
/// 而那不是限制。
///
/// ## 為什麼要落地成檔案
///
/// 這份集合原本只活在記憶體裡，於是**每次重開 App 就全部歸零**。後果不是
/// 「功能不能用」那麼明顯——`event-writer` 的 append 失敗是 `.catch(() => {})`
/// 吞掉的，所以稽核軌跡會在每次重啟之後**靜默停止寫入**，直到使用者剛好又去
/// 選了一次資料夾。那正是這個 App 拿來當賣點的那條軌跡。
///
/// 授權來源沒有變——仍然只有「使用者親手用系統選擇器選過」能加進來。改變的是
/// 那份授權會被記住，就像 macOS 的 security-scoped bookmark 一樣。
/// 代價寫在 `docs/SECURITY.md`：能寫這個檔的人可以塞進一個根目錄。但能寫到
/// App 資料夾的人本來就能做更糟的事。
#[derive(Default)]
pub struct RegisteredRoots {
    set: Mutex<HashSet<PathBuf>>,
    /// 落地位置。測試時為 None——不要讓單元測試互相污染同一份檔案。
    store: Mutex<Option<PathBuf>>,
}

impl RegisteredRoots {
    /// 指定落地檔並載回先前的授權。已經不存在的路徑會被丟掉——
    /// 一份指向已刪除資料夾的舊授權沒有保留的理由。
    pub fn attach(&self, path: PathBuf) {
        let loaded: Vec<PathBuf> = std::fs::read_to_string(&path)
            .ok()
            .and_then(|t| serde_json::from_str::<Vec<String>>(&t).ok())
            .unwrap_or_default()
            .into_iter()
            .map(PathBuf::from)
            .filter(|p| p.is_dir())
            .collect();
        if let Ok(mut s) = self.set.lock() {
            s.extend(loaded);
        }
        if let Ok(mut st) = self.store.lock() {
            *st = Some(path);
        }
        self.persist();
    }

    fn persist(&self) {
        let Ok(st) = self.store.lock() else { return };
        let Some(path) = st.as_ref() else { return };
        let Ok(set) = self.set.lock() else { return };
        let list: Vec<String> = set.iter().map(|p| p.to_string_lossy().to_string()).collect();
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string(&list) {
            let _ = std::fs::write(path, json);
        }
    }

    pub fn register(&self, p: &Path) {
        if let Ok(mut set) = self.set.lock() {
            set.insert(canonical(p));
        }
        self.persist();
    }

    pub fn contains_ancestor_of(&self, p: &Path) -> bool {
        let target = canonical(p);
        self.set
            .lock()
            .map(|set| set.iter().any(|root| target.starts_with(root)))
            .unwrap_or(false)
    }
}

/// 領域包檔的建立界線。**比 [`editable`] 鬆一點（允許建新檔），但範圍窄得多。**
///
/// `editable` 要求 `is_file()`，所以它建不了新檔——那是刻意的，寫入既有檔
/// 與憑空造檔是兩種風險。但領域包本來就需要建新檔（AI 產出、範本下載），
/// 於是給它一條自己的窄路：
///
/// 1. 目錄必須是使用者**親手選過**的（在已註冊根目錄內）——授權來源與 append 相同
/// 2. 檔名由 Rust 驗證，不是前端說了算：只收 `[A-Za-z0-9._-]`，且不得含
///    路徑分隔符或 `..`。前端只能決定「叫什麼名字」，不能決定「放到哪裡去」
/// 3. 副檔名限 `.md`
///
/// 這樣即使前端被注入，它能做的最壞的事是在使用者自己選的領域包資料夾裡
/// 多放一個 `.md`——而那個資料夾的內容本來就會被當成領域包讀進來。
pub fn domain_pack_writable(dir: &Path, name: &str, roots: &RegisteredRoots) -> bool {
    if !roots.contains_ancestor_of(dir) {
        return false;
    }
    if name.is_empty() || name.len() > 64 || name == ".." {
        return false;
    }
    if !name.to_ascii_lowercase().ends_with(".md") {
        return false;
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
    {
        return false;
    }
    // `..md` 之類：去掉副檔名後不能是空的或全是點
    let stem = &name[..name.len() - 3];
    !stem.is_empty() && stem.chars().any(|c| c != '.')
}

/// `canonicalize` 解得開就用解開的，解不開（檔案還不存在）就退回逐段正規化。
///
/// append 的目標檔第一次寫入時**還不存在**，所以不能無條件依賴 canonicalize。
/// 但父目錄通常存在，解父目錄一樣擋得住 symlink 逃逸。
fn canonical(p: &Path) -> PathBuf {
    if let Ok(c) = p.canonicalize() {
        return c;
    }
    match (p.parent(), p.file_name()) {
        (Some(parent), Some(name)) => match parent.canonicalize() {
            Ok(c) => c.join(name),
            Err(_) => normalize(p),
        },
        _ => normalize(p),
    }
}

/// 純字串正規化：拿掉 `.`、把 `..` 往上收。canonicalize 失敗時的保底。
fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .and_then(|p| p.canonicalize().ok())
}

/// `readFile` / `writeFile` / `openPath` 的界線。
///
/// 家目錄底下 ∧ 副檔名在白名單 ∧ 檔案已存在且是普通檔。
/// 「必須已存在」擋掉用寫入建立任意新檔。
pub const EDITABLE_EXTS: &[&str] = &["md", "markdown", "yaml", "yml", "json", "txt", "toml"];

pub fn editable(p: &Path) -> bool {
    let target = canonical(p);
    let Some(home) = home() else { return false };
    if !target.starts_with(&home) {
        return false;
    }
    let ext_ok = target
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| EDITABLE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false);
    ext_ok && target.is_file()
}

/// 稽核軌跡追加的界線。**比 [`editable`] 緊，因為它會建新檔。**
///
/// 四個條件同時成立：解析後仍在已註冊根目錄內（擋 symlink 逃逸）、
/// 相對路徑在 `.anchorline/` 底下、副檔名是 `jsonl`、而且呼叫端只能 append。
/// 最後一條由 command 分流保證 —— 這個函式看不到動作是什麼。
pub fn append_allowed(p: &Path, roots: &RegisteredRoots) -> bool {
    let target = canonical(p);
    if target
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        != Some("jsonl".into())
    {
        return false;
    }
    if !roots.contains_ancestor_of(&target) {
        return false;
    }
    // 相對路徑必須落在 .anchorline/ 底下。用 components 比對而不是字串 contains，
    // 否則 `~/x/not-.anchorline-really/a.jsonl` 這種名字會過。
    let Ok(set) = roots.set.lock() else {
        return false;
    };
    set.iter().any(|root| {
        target
            .strip_prefix(root)
            .ok()
            .and_then(|rel| rel.components().next())
            .map(|first| first.as_os_str() == ".anchorline")
            .unwrap_or(false)
    })
}

/// 單行上限。保住 O_APPEND 的原子性。
pub const MAX_LINE_BYTES: usize = 4096;

/// 一行事件：換行一律替換成空白、超長截斷、結尾補 `\n`。
///
/// **不是在做美化，是在維持 append-only 的不變式**：一筆事件一行。
/// 內容裡混進 `\n` 會讓下一次讀取多出一行壞掉的 JSON。
pub fn normalize_line(line: &str) -> String {
    let flat: String = line
        .chars()
        .map(|c| if c == '\n' || c == '\r' { ' ' } else { c })
        .collect();
    let mut out = if flat.len() > MAX_LINE_BYTES {
        let mut cut = MAX_LINE_BYTES.min(flat.len());
        while !flat.is_char_boundary(cut) {
            cut -= 1;
        }
        flat[..cut].to_string()
    } else {
        flat
    };
    out.push('\n');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_line_is_always_exactly_one_line() {
        let s = normalize_line("a\nb\r\nc");
        assert_eq!(s.matches('\n').count(), 1);
        assert!(s.ends_with('\n'));
        assert!(s.starts_with("a b"));
    }

    #[test]
    fn normalize_line_truncates_without_splitting_utf8() {
        let s = normalize_line(&"中".repeat(4000));
        assert!(s.len() <= MAX_LINE_BYTES + 1);
        assert!(std::str::from_utf8(s.as_bytes()).is_ok());
    }

    #[test]
    fn append_rejects_without_registered_root() {
        let roots = RegisteredRoots::default();
        assert!(!append_allowed(
            Path::new("/tmp/whatever/.anchorline/log/2026-08.jsonl"),
            &roots
        ));
    }

    #[test]
    fn append_requires_anchorline_dir_and_jsonl() {
        let tmp = std::env::temp_dir().join("sf-paths-test");
        let _ = std::fs::create_dir_all(tmp.join(".anchorline/log"));
        let roots = RegisteredRoots::default();
        roots.register(&tmp);

        assert!(append_allowed(&tmp.join(".anchorline/log/a.jsonl"), &roots));
        // 副檔名不對
        assert!(!append_allowed(&tmp.join(".anchorline/log/a.md"), &roots));
        // 不在 .anchorline/ 底下
        assert!(!append_allowed(&tmp.join("other/a.jsonl"), &roots));
        // 名字很像但不是那個目錄
        assert!(!append_allowed(
            &tmp.join(".anchorline-really/a.jsonl"),
            &roots
        ));
        // 逃出根目錄
        assert!(!append_allowed(
            &tmp.join("../escape/.anchorline/a.jsonl"),
            &roots
        ));
    }

    #[test]
    fn editable_rejects_missing_file_and_bad_ext() {
        assert!(!editable(Path::new("/definitely/not/here.md")));
        assert!(!editable(Path::new("/etc/passwd")));
    }
}
