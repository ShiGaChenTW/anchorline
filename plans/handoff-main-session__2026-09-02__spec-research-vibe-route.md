# Handoff — 2026-09-02 主 session:Spec 研究 → 流程評估 → PRD → 檔位系統 P1 落地

> 本檔是完整成果紀錄,供新 session 冷啟動與防資料遺失。一句話現況:**vibe coding spec 研究產出 HTML 報告 → 流程評估 17 條 → 專案 PRD 草稿 v0.4 → 第四檔路線「試作／探索」已實作、過跨廠商審查、commit `6dcd5c9`(未 push)——待 Scott 8 題實機 UAT。**

---

## 1. 研究交付物:Vibe Coding 下的 PRD/Spec 使用方式

- **HTML 報告**:Artifact https://claude.ai/code/artifact/4d284131-e9ee-4a01-9240-22774e3fd0d2 · 本機 `~/Documents/Last30Days/vibe-coding-spec-guide.html`(102 連結、11 節,全部來源經工具實查)
- **last30days raw**:`~/Documents/Last30Days/spec-driven-development-vibe-coding-prd-raw-v3.md`(46 筆:Reddit 24 / HN 13 / Bluesky 8 / GitHub;含 WebSearch 附錄)
- **研究方法**:三並行 agent(SDD 工具生態 18 條、正反辯論 19 條、規模分層 23 條)+ last30days 30 天掃描,重大斷言雙管道交叉

**核心五結論**:①共識是光譜非二選一(越大越 greenfield 越值得 spec;throwaway 純 vibe 連 Karpathy 都認可)②「prototype 不用寫文件」已修正為「不用手寫,但要 AI 生成人審 5–15 分鐘的最小意圖文件」③spec 被重新定義為「餵 AI 的 context 入口」,輕量實踐採用度遠高於全套 SDD 儀式④第一號反模式=實作細節進 spec;第二號=驗收條件不二元可測⑤未決三戰場:spec 壽命(living vs archive)、粒度、自然語言 spec 非決定性

**L0–L4 光譜**(報告 §01):L0 純 Vibe → L1 最小 PRD → L2 plan→spec.md 用完即棄 → L3 三檔案制 → L4 change-spec+contract(L5 spec-as-source 未證明)

**轉折訊號**(§05):AI 修 A 壞 B / pattern 被違反 / 第二人加入 / 真實用戶 / 三個月牆 / 摩擦感

## 2. Anchorline 流程優化評估(17 條,agent 唯讀產出)

**總診斷**:專案在光譜 L2.5–L3,spec 的量是對的;病灶=①spec 壽命失控(plans/ 93 檔 5 種 slug 不歸檔、6 份 UAT 95 題全「進行中」、規格檔尾長線頭)②驗證迴圈斷在人肉 UAT(63 檔零 DOM 測試)。方向:L3 收斂+局部機器化,不是升 L4。

| # | 建議 | 優先 | 工作量 | 狀態 |
|---|------|------|--------|------|
| 1 | 合併 6 份 UAT 成 ≤15 題精選,測完拆 `auth.ts` workaround(gate 卡 17 天) | P0 | M | 未動 |
| 2 | 補 DOM 測試環境(happy-dom),先蓋 ask/dialog-flow/submit-flow | P0 | L | 未動 |
| 3 | 廢除「先合再審」:審查一律 merge 前 | P0 | S | **本次已實踐**(Cato 審在 commit 前) |
| 4 | openspec 吃自己狗糧:change 進 `openspec/changes/`、完工 archive | P1 | M | **試點進行中**(add-vibe-route) |
| 5 | plans/ 生命週期:frontmatter 狀態+archive 子目錄+統一 slug | P1 | S | 未動 |
| 6 | 查「28 題寫回全空 vs 全標失敗」矛盾(Q-05) | P1 | S | 未動 |
| 7 | 教訓升級機器守門:`keyof Project` 對照測試、雙向合約進 config rules | P1 | S | 未動 |
| 8 | UAT 出題規範:每輪 ≤10 題、綁 commit | P1 | S | 本次新 UAT 8 題已照辦 |
| 9 | 綠了就推,main 不留未推 commit 過夜(推前仍問) | P2 | S | main 現 ahead 3 |
| 10 | 規格檔尾線頭歸 backlog,spec 完工凍結 | P2 | S | 已收進 PRD 2.3 |
| 11 | repo 慣例集中一處(CLAUDE.md vs config.yaml 各寫一半) | P2 | S | 未動 |
| 12 | handoff 模板化瘦身(四段制) | P2 | S | 未動 |
| 13 | 用自家 App 開 Anchorline 自己的 Lite PRD(投報比最高) | P1 | S | **變體完成**:docs/PRD.md 手寫 v0.4 |
| 14 | 退役舊模板 `TEMPLATE-prd.md`(缺非目標/驗收,必被自家 gate 擋) | P2 | S | 未動 |
| 15 | gate 權重校正:驗收標準升 block、metrics 降(現況與社群共識相反) | P2 | S | 未動 |
| 16 | Full 路線設計工件(心智圖/IA/Flow/字串表)標 plan 層選配 | P2 | M | 未動 |
| 17 | openspec 路線補 change-spec gate(brownfield 四要素做成 GateSpec 資料;市面沒人做) | P2 | M | 未動 |

## 3. docs/PRD.md(專案自己的 PRD,untracked、status: draft)

- 逆向生成,184→約 200 行,unified 模板 0–11 節;v0.4(另一 session 加了 Prior Art 節:27 組關鍵字、8 候選皆部分滿足、決策全新開發)
- **2.3 非目標是柵欄**:明確不做 8 條 + 未決線頭 12 條(P-1~P-6 / B1B2 / S-1~S-7 / R1 / R2 / 金鑰 / 簽章 / UAT 舊帳…每條標出處)
- **已拍板(全部 2026-09-02,Scott)**:
  - Q-01 簽章 $99/年 → **暫緩**(暫時不對外,對外化時重開)
  - Q-02 匯出金鑰 → **暫緩,保 round-trip**(自用注意備份檔存放)
  - Q-03 R1 → **兩段式**(先驗 agent 結構化輸出穩定度,不動 UI;diff UI 柵欄維持)
  - Q-06 PRD 路徑共存 → **已釐清**:App 只在「repo 註冊進 Anchorline 且走到送審/核准」才覆寫 `docs/PRD.md`(`prd-file.ts` 從 state 渲染不讀回);未註冊前安全;真狗糧時先匯入 App 再讓 App 接管
  - Q-08 第四檔命名 → **「試作／探索」**,UI 全程無 L 編號(避免與 flow-layers L1–L6 撞名)
  - Q-09 治理 → **一鍵自簽+錨點最小治理**,不完全跳過
  - Q-10 升檔閾值 → **6 change / 3 UAT 失敗**起步(P1 靜態文案,P3 才偵測)
  - Q-11 → **vibe 不產 openspec change**,追蹤先用 plans 檔
  - Q-12 → **vibe 一律忽略領域包**;lite/full 維持現行
- **仍待拍板**:Q-04(R2 紀錄載體)、Q-05(28 題寫回之謎)、Q-07(M5 外部訊號)、線頭 #8/#9/#10、次要用戶定位、開放問題期限、第 9 節 GSM

## 4. 檔位系統 UX 設計(plan 報告要點,已批准照建議)

- **對齊判定**:擴充現有 triage,四檔=vibe → openspec → lite → full;L4 contract 撞柵欄排除;不用 L 編號
- **五方向判定**:(a)選擇器+章節清單預覽=修改採用 (b)問任務不問程度(首啟一題四選項)=修改採用 (c)綁專案+rail-nav 漸進揭露(收合不消失)=採用 (d)雙曲線=否決(改路線卡一行誠實代價) (e)升檔偵測=修改採用(訊號改 git revert/change 累積/UAT 失敗聚集;一行灰字+snooze,永不 modal 永不紅)
- **分期**:P1 vibe 路線(已完成)→ P2 首啟一題+導航漸進揭露(`onboarding.html`/`first-run-tour.ts`/`rail-nav.ts`,~6–8 檔,**開工前須知會 tiamat-fe**)→ P3 升檔訊號(`route-signals.ts` 純函式,~4–6 檔)
- §04 矩陣併入:四卡「時機」行、gate 差異表、升檔=種子重生(架構預設行為,成本≈0 併入 P1)

## 5. add-vibe-route 實作(commit `6dcd5c9`)

- **openspec change**:`openspec/changes/add-vibe-route/`(proposal 75 行含五拍板 Decisions/tasks 45 行 16 項/spec 75 行五 Requirements)——狗糧試點,**UAT 過後要 `openspec archive add-vibe-route`**
- **實作**:21 檔 +1424/−55。要點:`VIBE_SECTIONS=[summary,problem,goals]`、`VIBE_GATE_SPEC` 純資料(what+non-goals≥1 兩道 block,warn/hints/emptySections 關)、持久化三元改「full 才落 undefined」、`prd-file.ts` 標籤查表化(漏路線 tsc 擋)、四卡時機行、升檔種子文案、`selfSignVibe` 一鍵自簽、route-grid 四欄(1100/900 斷點)
- **預標兩地雷都有測試釘住**:`store.ts:1922` 持久化回退、`prd-file.ts:138` 標籤誤標
- **驗證(主 session 親跑)**:`tsc` 零錯、`bun test` **2098 pass / 0 fail**(基準 2042,+56,5333 expect)
- tasks.md 15/16(9.2 實機勾選=Scott)

## 6. Cato 跨廠商審查(request-changes → 已全數回修)

**過關項**:持久化 migration(round-trip 測試)、gate 依路線分流、領域包反向對照測試(點名讚)、五條拍板忠實度、UI 零 L 編號。

**發現與回修對照**:

| 發現 | 回修 |
|------|------|
| C1 自簽繞過族系隔離(canSelfSign 未查 separationOfDuties,連「沒有 admin 例外」的族系守門一起丟) | 補族系分支:同族系 agent → can:false;只豁免「人的自審」;註解改寫。測試:同族擋/異族可 |
| C2 「切 vibe→自簽→切回」=通用核准繞道;open() 含 changes_requested 可翻審閱者負向裁決;核准狀態跨路線殘留 | open() 移除 changes_requested;離開 vibe 時自簽 approved(`SELF_SIGN_NOTE` 前綴)重設 pending,log+錨點保留;升檔文案補「轉正後需走正式簽核」;繞道測試改寫成守門測試 |
| M1 store 層缺 canEditContent/locked 守門,`locked:false` 是解鎖動作 | 補守門;`locked: c.locked ?? false`;canSelfSign 擋已鎖案 |
| M2 allStagesSettled 誤判(全 skip 專案永遠簽不了=違反「不得完全跳過簽核」) | 判準改查 c.log 自簽事件;文案改實況;全 skip 可自簽測試 |
| m1 種子文案「已寫的 N 節」在有歷史內容時說謊 | 改「試作的 3 節」(描述路線);spec.md 已同步(主 session 改) |
| m2 deriveFlowLayers gateSpec 選填,漏傳靜默回 BASE | 四呼叫端(review:748/editor:1438/projects:206/tracking:1340)確認後改**必填**,tsc 露餡 |
| 補測 | VIBE_GATE_SPEC 缺 hints/emptySections 的直譯器容錯 describe |

**Cato 未覆蓋範圍(殘留風險,後續留意)**:①送審預檢在 vibe 專案的完整行為(自簽後送審會否重建關卡)②四份修改過的測試檔未逐條讀③editor.html 自簽鈕與鍵盤/焦點互動(本 repo 有 2026-08-16 熱鍵前科,屬 UAT 範疇)。
**運維教訓**:Cato(codex)5-turn 上限,大 diff 要三輪(讀→讀→強制吐結論);最後一輪指令「停止工具呼叫,用已讀內容出結論+列未覆蓋」有效。

## 7. Git 狀態(截至本檔寫成)

- `main` = `6dcd5c9`,**領先 origin 3 commit**:`bc31745`(unified 範本 15 章)/`b47274a`(路線持久化+PRD 落檔)/`6dcd5c9`(試作／探索)——**push 前問 Scott**
- 工作樹 untracked:`docs/PRD.md`(draft 待審)、本 handoff 檔
- `6dcd5c9` 含:實作 15 檔+4 測試檔+openspec change 4 檔+UAT 題檔

## 8. 跨 session 接縫協議(與 tiamat-fe,2026-09-02)

- 對方:介面改版線,worktree `~/orca/workspaces/Project_Anchorline/tiamat`,分支 `redesign-ui-aidesigner`;落點 `shared.css`(卡片/焦點卡/間距 token)+`dashboard.ts`;基線=6dcd5c9,零漂移
- **接縫**:`.route-grid`(四欄,1100px→2 欄、900px→1 欄)——任一方動它先知會
- 對方動建案流程/route 卡片前敲本線;本線 **P2 開工前必敲對方**(onboarding/first-run-tour/rail-nav 是對方腹地)
- 協議同步記在 `~/.claude/LIFEOS/USER/PROJECTS/PROJECTS.md`
- **接縫擴充(2026-09-02 第二輪,tiamat-fe 提出、本線接受)**:
  - S-1 `plans/` 重整(建議 [5])開工前敲對方(其 worktree 有 4 個交叉引用的未追蹤檔);方案須含改名對照表
  - S-2 `status-bar.ts` 暫歸對方獨佔;本線線頭 #8 未拍板不動;若拍板,需求交對方併進其 P1-1 一次改
  - S-3 對方 `SECTION_SUBSTANCE_MIN`(12 字)刻意不對齊 gate 門檻=設計決策(gate 答合格、pct 答進度),**不得當 bug 修**;建議 [15]/[17] 動工前知會
  - S-4 對方實測:`syncPrdFiles` 只掛 `store.ts:1957`(送審)/`:2001`(核准),自簽不觸發——手寫 PRD 不會被自簽蓋掉
  - S-5 建議 [11] 慣例搬家前敲對方,附新舊段落對照
  - **歸屬:Cato 殘留①=對方缺口 #10(自簽後轉正沿用建案當下關卡、零提示)歸本線,立為 PRD Q-13,UAT 後 archive 前處理**
  - 對方 Phase 0 已實作未 commit(store/flow-layers/signoff/projects+測試,零 UI/CSS),已提醒對 6dcd5c9 重驗(deriveFlowLayers 簽名已變)

## 9. 下一步(依序)

1. **Scott:8 題實機 UAT** — `plans/uat-第四檔路線「試作／探索」實測-2.md`(已按回修後文案重出;舊版已刪)
2. UAT 過 → `openspec archive add-vibe-route`(狗糧完整一輪)+ 問過 Scott 後 push(ahead 3)
3. 拍板剩餘:Q-04 / Q-05(=建議 [6] 可派查)/ Q-07;PRD status draft→active
4. P0 舊帳:合併 95 題 UAT 積壓(建議 [1])、DOM 測試環境(建議 [2])
5. P2 開工前:知會 tiamat-fe;P3 在 P2 後
6. 建議 [14][15][17] 等 P2 級流程項排程

---
*寫於 2026-09-02,主 session(spec 研究線)。相關 ISA:`~/.claude/MEMORY/WORK/vibe-coding-prd-sdd-research/ISA.md`(已 complete)。*
