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
        let list: Vec<String> = set
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
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

/// Function wish list 的落點。檔名寫死——前端不能說「寫到哪裡去」。
pub const WISHLIST_FILE: &str = "function-wishlist.md";

pub fn wishlist_path(root: &Path) -> PathBuf {
    root.join(".anchorline").join(WISHLIST_FILE)
}

/// 建／覆寫 wishlist 的界線：資料夾必須是使用者親手選過的專案根（或其子路徑）。
///
/// 比 [`editable`] 鬆（允許建新檔），比 [`domain_pack_writable`] 緊（檔名不由前端決定）。
pub fn wishlist_writable(dir: &Path, roots: &RegisteredRoots) -> bool {
    roots.contains_ancestor_of(dir)
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

/// UAT 證物檔名：`T1-01.png` / `S12-03.jpg`。前端只能說這個形狀，不能帶路徑。
pub fn uat_evidence_name_ok(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    if !matches!(
        ext.to_ascii_lowercase().as_str(),
        "png" | "jpg" | "jpeg" | "webp"
    ) {
        return false;
    }
    let Some((kind, seq)) = stem.split_once('-') else {
        return false;
    };
    let mut chars = kind.chars();
    let Some(prefix) = chars.next() else {
        return false;
    };
    if prefix != 'T' && prefix != 'S' {
        return false;
    }
    let digits: String = chars.collect();
    !digits.is_empty()
        && digits.len() <= 3
        && digits.chars().all(|c| c.is_ascii_digit())
        && seq.len() == 2
        && seq.chars().all(|c| c.is_ascii_digit())
}

pub fn uat_evidence_prefix_ok(prefix: &str) -> bool {
    let mut chars = prefix.chars();
    let Some(head) = chars.next() else {
        return false;
    };
    if head != 'T' && head != 'S' {
        return false;
    }
    let digits: String = chars.collect();
    !digits.is_empty() && digits.len() <= 3 && digits.chars().all(|c| c.is_ascii_digit())
}

pub const MAX_UAT_EVIDENCE_BYTES: usize = 8 * 1024 * 1024;

/// 報告檔 → 證物落地路徑。
///
/// 已註冊專案根 ∧ 報告在 `plans/*.md` ∧ 檔名通過 [`uat_evidence_name_ok`]。
/// 目錄可以還不存在（這條路允許建檔）。
pub fn uat_evidence_dest(
    report: &Path,
    name: &str,
    roots: &RegisteredRoots,
) -> Result<PathBuf, String> {
    if !uat_evidence_name_ok(name) {
        return Err("檔名只能是 T1-01.png 或 S1-01.jpg 這種形狀".into());
    }
    if !roots.contains_ancestor_of(report) {
        return Err("這份報告不在你選過的專案裡，不能寫附件".into());
    }
    let ext = report
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    if !matches!(ext.as_deref(), Some("md") | Some("markdown")) {
        return Err("附件只能掛在 markdown 報告下面".into());
    }
    if !report.is_file() {
        return Err("找不到這份報告，無法寫附件".into());
    }
    let parent = report.parent().ok_or("報告路徑不完整")?;
    if parent.file_name().and_then(|s| s.to_str()) != Some("plans") {
        return Err("附件只准寫在 plans/uat-assets/ 底下".into());
    }
    let stem = report
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("報告檔名無法當成目錄名")?;
    if stem.is_empty() || stem.contains("..") || stem.contains('/') || stem.contains('\\') {
        return Err("報告檔名不適合作為附件目錄".into());
    }
    Ok(parent.join("uat-assets").join(stem).join(name))
}

pub fn uat_evidence_rel(report: &Path, name: &str) -> String {
    let stem = report
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("uat");
    format!("uat-assets/{stem}/{name}")
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

/// `editable` 為什麼不通過。
///
/// `editable` 只回 bool，四種截然不同的原因（不在家目錄／副檔名不支援／
/// 檔案不存在／不是普通檔）共用同一句錯誤訊息，使用者看不出下一步是什麼。
/// 這支把原因講出來 —— 診斷用，不改變任何判定。
pub fn why_not_editable(p: &Path) -> String {
    let target = canonical(p);
    let Some(home) = home() else {
        return "找不到家目錄，無法判斷這個路徑是否可讀".into();
    };
    if !target.starts_with(&home) {
        return format!("「{}」不在家目錄底下，基於安全不開放存取", target.display());
    }
    let ext = target
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    match ext {
        Some(e) if EDITABLE_EXTS.contains(&e.as_str()) => {}
        Some(e) => return format!("不支援 .{e} 這種檔案，只能開 {}", EDITABLE_EXTS.join(" / ")),
        None => return "這個路徑沒有副檔名，判斷不出是不是文件檔".into(),
    }
    // `exists()` / `is_file()` 把「不存在」與「不准看」混成同一個 false。
    // macOS 的 TCC 擋掉家目錄下的 Documents／Desktop 時連 stat 都不給，
    // 這裡若直接說「檔案被刪掉了」就是把人導向完全錯的方向。
    match std::fs::symlink_metadata(&target) {
        Ok(m) if m.is_file() => format!("「{}」無法存取（原因不明）", target.display()),
        Ok(m) if m.is_dir() => format!("「{}」是資料夾，不是檔案", target.display()),
        Ok(_) => format!("「{}」不是普通檔案", target.display()),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => format!(
            "macOS 不讓這個 App 看「{}」。到「系統設定 → 隱私權與安全性 → 檔案與資料夾」\
             把 Anchorline 的存取權打開；清單裡沒有它的話，用「專案匯入」重新選一次資料夾\
             就會跳出授權對話框。",
            target.display()
        ),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => format!(
            "找不到「{}」—— 檔案可能被移動或刪掉了，重新匯入這個專案可以更新路徑",
            target.display()
        ),
        Err(e) => format!("看不到「{}」：{e}", target.display()),
    }
}

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

/// 這個路徑「就是」某個已註冊的專案根目錄嗎。回它的正規化形式。
///
/// 刻意用**完全相等**而不是 `contains_ancestor_of`：後者會讓
/// `<root>/node_modules/whatever` 也被當成一個合法的專案根。呼叫端接著會拿它
/// 去接相對路徑，於是白名單裡的相對形狀可以被種在專案內的任何一層。
pub fn registered_root(project_root: &Path, roots: &RegisteredRoots) -> Option<PathBuf> {
    let root = canonical(project_root);
    let set = roots.set.lock().ok()?;
    set.iter().any(|r| r == &root).then_some(root)
}

fn slug_ok(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && !s.starts_with('-')
        && !s.ends_with('-')
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn plan_name_ok(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".md") else {
        return false;
    };
    !stem.is_empty()
        && stem.len() <= 96
        && stem
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// change 產出可以落在哪裡。**比 [`domain_pack_writable`] 緊，因為它會建目錄。**
///
/// 前端送的是相對路徑而不是檔名，因為 openspec 的產出本來就是有結構的
/// （`changes/<id>/specs/<domain>/spec.md` 有四層）。用檔名 + 固定目錄表達不了。
/// 代價是這裡必須把**整個形狀**列舉出來——只擋 `..` 是不夠的：`.git/hooks/`、
/// `node_modules/`、`src/` 都是合法的相對路徑，而它們一個都不該被這條路徑寫到。
///
/// 白名單只有三種形狀，對應 `change-templates.ts` 產出的五種檔案。前端的模板
/// 換路徑時這裡要跟著改——那是刻意的：兩邊都要動，才不會有人單方面把產出
/// 搬到別的地方而沒人發現。
pub fn change_bundle_rel_ok(rel: &str) -> bool {
    let parts: Vec<&str> = rel.split('/').collect();
    // 空段擋掉 `a//b` 與開頭的 `/`；`.`／`..` 擋掉往上跳
    if parts
        .iter()
        .any(|p| p.is_empty() || *p == "." || *p == ".." || p.contains('\\'))
    {
        return false;
    }
    match parts.as_slice() {
        ["plans", name] => plan_name_ok(name),
        ["openspec", "changes", slug, file] => {
            slug_ok(slug) && matches!(*file, "proposal.md" | "design.md" | "tasks.md")
        }
        ["openspec", "changes", slug, "specs", domain, "spec.md"] => {
            slug_ok(slug) && slug_ok(domain)
        }
        _ => false,
    }
}

/// 稽核軌跡讀取的界線。**唯讀，而且只認一個目錄。**
///
/// 刻意不共用 [`editable`]：那條的白名單沒有 `jsonl`，而把 `jsonl` 加進去會
/// 連 `writeFile` 與 `openPath` 一起開放 —— append-only 的檔就變成可整檔覆寫，
/// 那正是 [`append_allowed`] 存在的理由。這條只回一個目錄路徑，呼叫端只能讀
/// 它底下的分片，不能指定檔案。
///
/// 回 `None` 代表這個根目錄沒被使用者親手選過。前端傳來的路徑只能被檢查，
/// 不能被信任成根目錄。
pub fn log_dir_of(project_root: &Path, roots: &RegisteredRoots) -> Option<PathBuf> {
    let root = canonical(project_root);
    let Ok(set) = roots.set.lock() else {
        return None;
    };
    // 必須「就是」某個已註冊根目錄，不是「在它底下」——後者會讓
    // `<root>/node_modules/evil` 這種路徑也拿得到一個 log 目錄。
    if !set.iter().any(|r| r == &root) {
        return None;
    }
    Some(root.join(".anchorline").join("log"))
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
    fn log_dir_rejects_unregistered_root() {
        let roots = RegisteredRoots::default();
        assert!(log_dir_of(Path::new("/tmp/whatever"), &roots).is_none());
    }

    #[test]
    fn log_dir_only_accepts_the_root_itself() {
        let dir = std::env::temp_dir().join("anc-logdir-test");
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        let roots = RegisteredRoots::default();
        roots.register(&dir);

        assert_eq!(
            log_dir_of(&dir, &roots),
            Some(canonical(&dir).join(".anchorline").join("log"))
        );
        // 「在已註冊根目錄底下」不夠 —— 否則任何子目錄都能換到一個 log 路徑，
        // 而使用者授權的是那個專案，不是它底下的每一個資料夾。
        assert!(log_dir_of(&dir.join("node_modules"), &roots).is_none());

        std::fs::remove_dir_all(&dir).ok();
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
    fn uat_evidence_name_is_closed() {
        assert!(uat_evidence_name_ok("T1-01.png"));
        assert!(uat_evidence_name_ok("S12-03.JPG"));
        assert!(uat_evidence_prefix_ok("T1"));
        assert!(uat_evidence_prefix_ok("S12"));
        assert!(!uat_evidence_name_ok("../T1-01.png"));
        assert!(!uat_evidence_name_ok("T1-1.png"));
        assert!(!uat_evidence_name_ok("X1-01.png"));
        assert!(!uat_evidence_prefix_ok("T"));
        assert!(!uat_evidence_prefix_ok("TT1"));
    }

    #[test]
    fn uat_evidence_dest_stays_under_plans_assets() {
        let tmp = std::env::temp_dir().join("sf-uat-ev-test");
        let plans = tmp.join("plans");
        let _ = std::fs::create_dir_all(&plans);
        let report = plans.join("uat-demo.md");
        let _ = std::fs::write(&report, "# UAT: x\n");
        let roots = RegisteredRoots::default();
        roots.register(&tmp);
        let dest = uat_evidence_dest(&report, "T1-01.png", &roots).unwrap();
        assert!(dest.ends_with("plans/uat-assets/uat-demo/T1-01.png"));
        assert!(uat_evidence_dest(&report, "../T1-01.png", &roots).is_err());
        assert!(uat_evidence_dest(&tmp.join("other.md"), "T1-01.png", &roots).is_err());
    }

    #[test]
    fn editable_rejects_missing_file_and_bad_ext() {
        assert!(!editable(Path::new("/definitely/not/here.md")));
        assert!(!editable(Path::new("/etc/passwd")));
    }
}

#[cfg(test)]
mod why_not_editable_tests {
    use super::*;

    /// 不在家目錄底下 → 講邊界，不要講「檔案不見了」
    #[test]
    fn outside_home_says_boundary() {
        let msg = why_not_editable(Path::new("/etc/hosts"));
        assert!(msg.contains("不在家目錄"), "got: {msg}");
    }

    /// 副檔名不支援 → 要列出支援的種類，使用者才知道下一步
    #[test]
    fn bad_extension_lists_supported() {
        let Some(home) = home() else { return };
        let msg = why_not_editable(&home.join("some-file.png"));
        assert!(msg.contains("不支援"), "got: {msg}");
        assert!(msg.contains("md"), "應列出支援的副檔名, got: {msg}");
    }

    /// 家目錄下、副檔名合法、但檔案真的不存在 → 才可以說「找不到」
    #[test]
    fn missing_file_says_missing_not_permission() {
        let Some(home) = home() else { return };
        let msg = why_not_editable(&home.join("definitely-not-here-9f3a2b1c.md"));
        assert!(msg.contains("找不到"), "got: {msg}");
        assert!(!msg.contains("隱私權"), "不該誤報成權限問題, got: {msg}");
    }

    #[test]
    fn change_bundle_accepts_exactly_the_five_template_shapes() {
        // 這五條對應 change-templates.ts 產出的檔案。模板改路徑時這裡要一起改。
        for ok in [
            "openspec/changes/audit-export/proposal.md",
            "openspec/changes/audit-export/design.md",
            "openspec/changes/audit-export/tasks.md",
            "openspec/changes/audit-export/specs/audit-export/spec.md",
            "plans/2026-08-22-bug-login-loop.md",
        ] {
            assert!(change_bundle_rel_ok(ok), "應該放行: {ok}");
        }
    }

    #[test]
    fn change_bundle_rejects_escapes_and_other_project_paths() {
        for bad in [
            // 往上跳
            "openspec/changes/../../../../etc/passwd",
            "plans/../.git/hooks/pre-commit",
            "../plans/x.md",
            // 絕對路徑與空段
            "/etc/passwd",
            "openspec//changes/x/proposal.md",
            // 形狀對但檔名不在白名單
            "openspec/changes/x/README.md",
            "openspec/changes/x/specs/y/design.md",
            // 專案裡其他合法但不該被這條路徑碰的地方
            ".git/hooks/pre-commit",
            "src/main.ts",
            "node_modules/x/index.js",
            ".anchorline/log/a.jsonl",
            // slug 形狀
            "openspec/changes/-lead/proposal.md",
            "openspec/changes/Upper/proposal.md",
            "openspec/changes/has space/proposal.md",
            // plans 只收 .md
            "plans/x.sh",
            "plans/.md",
        ] {
            assert!(!change_bundle_rel_ok(bad), "應該擋下: {bad}");
        }
    }
}
