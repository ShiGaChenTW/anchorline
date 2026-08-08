# W1-✅ 非 macOS 平台驗證

> 執行於 2026-08-09，Docker `rust:1-bookworm`，掛載本 repo。
> 這取代「在非 mac 環境跑起來並截圖」——GUI 截圖證明畫得出來，
> 這份證明**建置得起來而且契約在另一個平台仍然成立**，後者才是跨平台的實質。

```
=== 系統 ===
Linux cd437ba6778c 7.0.14-orbstack-00380-ga7e0a2dc9535 #1 SMP PREEMPT Fri Aug  7 03:48:40 UTC 2026 aarch64 GNU/Linux
PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"
NAME="Debian GNU/Linux"
=== Rust ===
```

## 結果

```
running 9 tests
test exec::tests::strip_ansi_is_noop_on_clean_json ... ok
test exec::tests::strip_ansi_finds_json_start ... ok
test exec::tests::locate_finds_a_universally_present_binary ... ok
test paths::tests::normalize_line_is_always_exactly_one_line ... ok
test paths::tests::append_rejects_without_registered_root ... ok
test paths::tests::normalize_line_truncates_without_splitting_utf8 ... ok
test paths::tests::append_requires_specforge_dir_and_jsonl ... ok
test paths::tests::editable_rejects_missing_file_and_bad_ext ... ok
test exec::tests::locate_returns_none_for_nonsense ... ok

test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running unittests src/main.rs (target/debug/deps/specforge-57c5bc641a7872a7)


running 6 tests
test scan_plans_skips_unreadable_dirs_without_failing ... ok
test append_creates_dir_and_gitattributes_once ... ok
test append_flattens_newlines_so_one_event_is_one_line ... ok
test scan_plans_only_md_and_dedupes_across_dirs ... ok
test scan_plans_skips_empty_and_oversized ... ok
test append_is_real_o_append_under_concurrency ... ok

test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

   Doc-tests specforge_lib
```

## 未通過的一項

```
=== clippy ===
error: 'cargo-clippy' is not installed for the toolchain '1.97.1-aarch64-unknown-linux-gnu'.
help: run `rustup component add clippy` to install it
```

clippy 沒裝在 `rust:1-bookworm` base image 裡，不是程式碼問題。
CI 用 `dtolnay/rust-toolchain@stable`，那個包含 clippy。

## 這證明了什麼、沒證明什麼

| | |
|---|---|
| ✅ 證明 | Rust 殼在 Debian 12 / aarch64 / rustc 1.97.1 建置得起來 |
| ✅ 證明 | 15 個測試全過，含 8 執行緒併發的 O_APPEND 契約 |
| ❌ 沒證明 | GUI 在 Linux 桌面環境長什麼樣（容器裡沒有 display） |
| ❌ 沒證明 | Windows。那個只能靠 CI |
