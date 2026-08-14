//! `valid_history_name` 的契約測試。
//!
//! 這支函式是 `uat_format_history_read` 的**唯一**守門員 —— 那是整組 UAT 格式
//! 指令裡唯一收前端字串的入口。它是手寫的 `^[0-9]{8}-[0-9]{6}(-[0-9]+)?\.md$`，
//! 手寫正規式的失敗方式是「看起來對，但少擋了一種形狀」，所以逃逸案例
//! （`..`、路徑分隔符、多餘段落）必須逐一釘住，不能只測 happy path。

use anchorline_lib::testing::valid_history_name;

#[test]
fn accepts_the_two_canonical_shapes() {
    assert!(valid_history_name("20260814-120000.md"));
    // 同一秒內的第二份快照
    assert!(valid_history_name("20260814-120000-2.md"));
    assert!(valid_history_name("20260814-120000-50.md"));
    assert!(valid_history_name("00000000-000000.md"));
}

#[test]
fn rejects_path_traversal() {
    // 這一組是這支函式存在的理由。任何一條通過都等於任意檔案讀取。
    assert!(!valid_history_name("../uat-format.md"));
    assert!(!valid_history_name("../../.ssh/id_rsa.md"));
    assert!(!valid_history_name("20260814-120000/../../secret.md"));
    assert!(!valid_history_name("/etc/passwd.md"));
    assert!(!valid_history_name("..\\windows\\system.md"));
    assert!(!valid_history_name("20260814-120000-..md"));
}

#[test]
fn rejects_wrong_digit_counts() {
    assert!(!valid_history_name("2026814-120000.md")); // 日期少一碼
    assert!(!valid_history_name("202608141-120000.md")); // 日期多一碼
    assert!(!valid_history_name("20260814-12000.md")); // 時間少一碼
    assert!(!valid_history_name("20260814-1200000.md")); // 時間多一碼
}

#[test]
fn rejects_structural_variants() {
    assert!(!valid_history_name("20260814.md")); // 少了時間段
    assert!(!valid_history_name("20260814-120000-2-3.md")); // 多一段
    assert!(!valid_history_name("20260814-120000-.md")); // 序號是空的
    assert!(!valid_history_name("20260814-120000-a.md")); // 序號不是數字
    assert!(!valid_history_name("2026081a-120000.md")); // 日期夾了字母
    assert!(!valid_history_name("")); // 空字串
    assert!(!valid_history_name(".md"));
}

#[test]
fn rejects_wrong_extension() {
    assert!(!valid_history_name("20260814-120000")); // 沒有副檔名
    assert!(!valid_history_name("20260814-120000.txt"));
    assert!(!valid_history_name("20260814-120000.md.sh"));
    // 大小寫敏感：正規式寫的是小寫 `.md`
    assert!(!valid_history_name("20260814-120000.MD"));
}

#[test]
fn rejects_whitespace_and_control_characters() {
    assert!(!valid_history_name(" 20260814-120000.md"));
    assert!(!valid_history_name("20260814-120000.md "));
    assert!(!valid_history_name("20260814-120000.md\n"));
    // 換行接第二個看起來合法的名字 —— 沒有錨定的正規式會被這招騙過
    assert!(!valid_history_name("bad\n20260814-120000.md"));
}
