## ADDED Requirements

### Requirement: 第四條路線「試作／探索」

建案的路線表 SHALL 提供第四張卡「試作／探索」，與 full／lite／openspec
並列，欄位齊全（名稱／規模／說明／適用情境／時機）。

UI 的任何地方 SHALL NOT 出現 L0–L4 檔位編號——flow-layers 已用 L1–L6，
撞名的混亂比對齊社群術語的好處貴。

#### Scenario: 建案時看到四張卡
- **WHEN** 使用者開啟建案的路線選擇
- **THEN** 四張卡並列，「試作／探索」的規模欄寫「意圖 1 頁 · 3 欄位」

#### Scenario: 卡片上的時機文案
- **WHEN** 使用者看四張路線卡
- **THEN** 每張卡都有一行「時機」（vibe：動工前 5 分鐘 AI 起草你只審），
  且升檔訊號只以靜態文案呈現，系統不做任何自動偵測

### Requirement: vibe 檔的章節範圍

vibe 檔 SHALL 只顯示三節：三行摘要（summary）、問題（problem）、
目標（goals）。使用者自訂章節 SHALL 維持永遠可見（與 lite 同一條規則）。

#### Scenario: 建立 vibe 檔
- **WHEN** 使用者選「試作／探索」建案
- **THEN** 編輯台只出現三節，完成度與 gate 都只以這三節計

#### Scenario: 重新載入不回退
- **WHEN** vibe 專案存檔後重新載入 App
- **THEN** 路線仍是 vibe、仍只見三節（不重演 lite 當年「重載變回
  Full、15 節長回來、沒有任何錯誤」的坑）

### Requirement: vibe 檔的 gate

vibe 檔的結構 gate SHALL 用獨立的最小規則組：三行摘要只查「做什麼」、
Non-Goals 降為至少 1 條（仍為 block）；指標類 gate、warn 組與 hints、
空章節檢查 SHALL 全部關閉。

vibe 檔 SHALL 一律忽略領域包的 gate 規則；lite/full 的 gate 行為
SHALL 維持現行不變。

#### Scenario: vibe 檔掛了領域包
- **WHEN** vibe 專案的領域設了某個帶 gate 規則的領域包
- **THEN** gate 結果與未掛領域包時完全相同

#### Scenario: 只寫了「做什麼」
- **WHEN** vibe 檔的三行摘要只填了「做什麼」、加了 1 條 Non-Goal
- **THEN** 沒有任何 block（給誰／為何現在不查、指標不查）

### Requirement: 升降檔保留內容

vibe 與 lite/full 之間切換 SHALL 沿用「檢視過濾器，不是資料遷移」：
已寫正文原封不動。升檔對話框 SHALL 顯示種子文案
「試作的 3 節原樣保留，新增 N 節待補;轉正後需走正式簽核」，N 從目標路線章節數計算。

#### Scenario: vibe 升 lite
- **WHEN** 寫了三節的 vibe 檔升到 lite
- **THEN** 對話框寫明保留 3 節、待補節數為計算值；確認後三節內容逐字仍在

### Requirement: 最小治理——一鍵自簽＋錨點

vibe 檔的簽核 SHALL 是一鍵自簽：一個動作完成簽核並寫入 `anc:t=` 錨點
事件進稽核軌跡。系統 SHALL NOT 讓 vibe 檔完全跳過簽核——完全跳過的
代價是轉正時治理鏈沒有起點可 replay。

vibe 檔 SHALL NOT 被要求產生 openspec change；追蹤用 plans 檔。

#### Scenario: 一鍵自簽
- **WHEN** 使用者在 vibe 檔按下自簽
- **THEN** 簽核完成、稽核軌跡多一筆帶錨點的事件，事後 replay 讀得到

#### Scenario: 轉正後的鏈條
- **WHEN** vibe 檔升檔並走正式簽核
- **THEN** 自簽時期的錨點事件仍在軌跡裡，治理 replay 涵蓋升檔前後
