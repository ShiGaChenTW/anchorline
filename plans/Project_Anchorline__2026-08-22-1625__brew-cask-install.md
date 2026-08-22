# Anchorline brew cask 一鍵安裝

**建立時間：** 2026-08-22 16:25
**最後更新：** 2026-08-22 16:36
**狀態：** 已完成

## 目標

讓 `brew install --cask shigachentw/tap/anchorline` 一行裝好 Anchorline，
並把安裝方式寫回 README（目前 README 只寫「請自行 build」）。

前置條件已就緒：`release.yml` 在推 `v*` tag 時會用 tauri-action 建三平台、
macOS 走 `--target universal-apple-darwin`，產出 **draft** release；
`ShiGaChenTW/homebrew-tap` 已存在（public），且已有 txtnimal 的 cask 可照抄形狀。

## Plan Steps

- [x] Step 1 — 推 `v1.1.0` tag，觸發 release.yml
- [x] Step 2 — 等 CI 建置完成，確認 macOS universal dmg 的實際檔名
- [x] Step 3 — 發佈 draft release（公開動作）
- [x] Step 4 — 下載 dmg 算 sha256，寫 `Casks/anchorline.rb` 進 homebrew-tap
- [x] Step 5 — 更新 homebrew-tap 的 README（表格 + 首次啟動 Gatekeeper 段落）
- [x] Step 6 — 更新 Anchorline README 的「安裝」段
- [x] Step 7 — 實機驗證：`brew install --cask` 真的裝得起來

## 決策紀錄

- 16:25 — 用 **cask** 不用 formula。Anchorline 是 GUI `.app`，formula 是給
  CLI 的。tap 裡 txtnimal 也是 cask，同一條路。
- 16:25 — cask 的 `url` 指向 GitHub Release 的 dmg，不自己 host。release.yml
  已經會產 dmg，不需要新的建置流程。
- 16:25 — caveats 要寫 Gatekeeper 解法。產物未簽章（release.yml 檔頭與 README
  都寫明），cask 預設會蓋 quarantine，不講清楚使用者會撞到「已損毀」。

## 阻塞 / 待決議

無

## 結束摘要

`brew install --cask shigachentw/tap/anchorline` 可用，本機實測裝起來並開得起來。

- release v1.1.0 已公開，7 個產物（macOS universal dmg／Windows exe+msi／
  Linux deb+rpm+AppImage／updater tar.gz）
- `Casks/anchorline.rb` 已推上 homebrew-tap（commit `25675a8`），
  sha256 `95d3e5af…687070`
- tap README 把 txtnimal 專用的首次啟動段落合併成一節「Unsigned builds」，
  兩個 cask 共用——同一個問題不該有兩份說明
- Anchorline README 的「安裝」段改成三條路：Homebrew／直接下載／自行建置

一個要記住的事實：cask 裝完的 App **帶著 quarantine 屬性**（實測 `xattr` 有
`com.apple.quarantine`），未簽章產物一定會被 Gatekeeper 擋。caveats 與兩份
README 都寫了 `xattr -dr` 的解法。真正的修法是簽章與 notarization（SCOPE.md W4），
在那之前這條說明不能拿掉。

brew 裝的 binary 與本機 `bun run app:install` 的產物 sha256 不同，是預期的：
CI 走 `--target universal-apple-darwin`（aarch64 + x86_64），本機只建 aarch64。
兩者來自同一個 commit `cc6e4e9`。
