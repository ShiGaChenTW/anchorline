#!/bin/sh
# Live tracking 段 1 的寫入端（SPEC-live-tracking.md §4 / §9）。
#
# 用法：anchorline-active.sh [路徑]
#   路徑省略時用 $CLAUDE_PROJECT_DIR，再退到 $PWD。
#
# 契約只有三條，刻意窄到任何能跑一行 shell 的東西都接得上：
#   1. 純文字，第一行是絕對路徑（.md plan 檔 / 專案根 / plans 目錄）
#   2. 新鮮度由檔案 mtime 決定，不寫時間戳在內容裡
#   3. **必須原子寫**：tmp → rename。消費端在 render loop 裡每秒讀一次，
#      非原子寫會讓它讀到半行路徑，然後安靜退回段 2 —— 症狀是「訊號有時候
#      有用有時候沒用」，極難除錯。
#
# ⚠️ 這個腳本只做「寫一個檔」。前一代寫入端（agenttask-tui 的 launch_tui.ts）
#    因為順便開終端視窗、而單實例守衛在多專案下失效，每次編輯都開一個新視窗，
#    最後把系統拖垮並於 2026-07-31 被停用。**寫入端不准開視窗、不准起進程。**
set -eu

target="${1:-${CLAUDE_PROJECT_DIR:-$PWD}}"
dir="${XDG_CONFIG_HOME:-$HOME/.config}/anchorline"

mkdir -p "$dir"
tmp="$dir/.active.tmp.$$"
printf '%s\n' "$target" > "$tmp"
mv -f "$tmp" "$dir/active"
