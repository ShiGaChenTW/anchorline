# 簽核流程重新設計 — 個人工作台版

- 專案：Project_Anchorline
- 開立：2026-08-25 23:25
- PM：Miles（主 session，不寫 code）
- 狀態：實作中

## 為什麼要改

現況「混亂」有三個結構原因，不是介面問題：

1. **簽核流程只有一份，全域共用。** `workflowStages` 存在 AppState 頂層，
   每次送審都 `caseFromWorkflow(id, state.workflowStages, employees)`
   （`src/data/store.ts:2435`）複製同一套關卡給每個專案。「不同類型 PRD 用不同
   簽核邏輯」現在沒有掛勾點 —— 改 A 專案的流程，B 專案下次送審也跟著變。
2. **Agent 執行結果靜默寫入 state。** `store.invokeAgent` 完成時直接改 state
   （`store.ts:3135–3155`）：`edit`/`coach` 把摘要追加進「開放問題」欄位，
   `review`/`approve` 自動貼一則留言。使用者沒機會看完整內容再決定存不存。
3. **權限建立在「公司有很多人」的前提上。** `permissions.canApproveProject` →
   `signoff.canSignStage` → `store.approveAndLock` 三處各判一次，繞著員工清單、
   admin 代簽、職責分立轉。

## 四個已拍板的決定

| # | 決定 | 理由 |
|---|------|------|
| D1 | 關卡骨架 = **整份 PRD 範本分類**給骨架 + **領域包**疊加合規關卡 | Scott 選「兩者疊加」 |
| D2 | 流程定義住範本，**第一次送審時複製一份落地到專案上** | 乙案（每輪重解析）會讓 `signoffTimeline` 因 stageId 改變而顯示「（已移除的關卡）」，而跨輪串接正是簽核紀錄最該講的事 |
| D3 | 權限三層**收斂成單一 `canSignStage`**；`accessRole` 只在 agent 身上有意義；**agent 族系隔離保留並升格為主要守門** | 個人工作台沒有第二個人當保險，族系隔離反而更重要 |
| D4 | 關卡帶 `kind: "review" \| "edit"`，pop-up 兩種形態 | Scott 選「依關卡類型而定」 |

## 五類 PRD 的簽核邏輯（本次要產出的內容）

`kind` 欄位：`review` = agent 只出意見，不碰 PRD 內文；`edit` = agent 提議內文修改。
`required: false` = 非必簽，不擋結案。

### lean —— 一頁式 PRD、精實 MVP PRD
| 序 | 關卡 | kind | 預設執行者 | 必簽 | mode |
|---|---|---|---|---|---|
| 1 | AI 結構審查 | review | agent | ✓ | sequential |
| 2 | 我核准 | review | human | ✓ | sequential |

### narrative —— Amazon PR/FAQ、六頁敘事備忘錄
| 序 | 關卡 | kind | 預設執行者 | 必簽 | mode |
|---|---|---|---|---|---|
| 1 | 敘事可讀性審查 | review | agent | ✓ | sequential |
| 2 | FAQ 完整度 | review | agent | ✗ | parallel |
| 3 | 我核准 | review | human | ✓ | sequential |

### enterprise —— 傳統完整 PRD、金融／法遵 PRD
| 序 | 關卡 | kind | 預設執行者 | 必簽 | mode |
|---|---|---|---|---|---|
| 1 | 結構完整度 | review | agent | ✓ | sequential |
| 2 | 風險與相依 | review | agent | ✓ | parallel |
| 3 | 技術可行性 | review | agent | ✓ | parallel |
| 4 | 文件補完 | edit | agent | ✗ | parallel |
| 5 | 我核准 | review | human | ✓ | sequential |

### agile —— Atlassian 產品需求藍圖、Shape Up Pitch
| 序 | 關卡 | kind | 預設執行者 | 必簽 | mode |
|---|---|---|---|---|---|
| 1 | 範圍胃口審查（appetite / no-goes） | review | agent | ✓ | sequential |
| 2 | 我核准 | review | human | ✓ | sequential |

### technical —— Google Design Doc、OpenSpec 全套
| 序 | 關卡 | kind | 預設執行者 | 必簽 | mode |
|---|---|---|---|---|---|
| 1 | 設計取捨審查（alternatives considered） | review | agent | ✓ | sequential |
| 2 | 規格一致性 | review | agent | ✗ | parallel |
| 3 | 我核准 | review | human | ✓ | sequential |

### 領域包疊加
- `payment` / `lending` / `wealth` / `digital_account` → 追加一關
  **「金融法遵與風險」**（review, agent, required, sequential, 插在「我核准」之前）
- `generic` → 不追加

合併規則：**同名關卡不重複**（領域包的關卡若與範本骨架同名，以骨架為準）。
`order` 於合併後重新編號；`我核准` 一律排最後。

## 實作分兩波

### Wave 1 — 資料層（單一 agent，不可並行）
所有 `store.ts` / `types.ts` 的改動集中在這一波，Wave 2 才不會互相衝突。

1. `src/data/types.ts`
   - `StageKind = "review" | "edit"`
   - `WorkflowStageDef` 加 `kind: StageKind`、`defaultActor: "human" | "agent"`
   - `CaseStage` 加 `kind?: StageKind`（舊資料視為 `"review"`）
   - `Project` 加 `workflowStages?: WorkflowStageDef[]`（落地後的流程，**專案自己的**）
   - `Template` 加 `stages?: WorkflowStageDef[]`（整份範本才有）
   - `AgentJob` 加 `landed?: "pending" | "saved" | "discarded"`
2. 新檔 `src/lib/workflow-resolve.ts` —— 純函式，零 I/O
   - `resolveWorkflow(templateCat, domainPack): WorkflowStageDef[]`
   - 骨架 + 領域包疊加 + 同名去重 + 重新編號 + 「我核准」殿後
3. `src/data/seed.ts` —— 五類骨架寫成資料（上表）
4. `src/lib/domain-pack.ts` —— frontmatter 解析 `stages:`
5. `src/data/store.ts`
   - `submitForReview(projectId, commitId, assignments?)` 接受逐關指派；
     專案尚未落地流程時，解析並寫入 `project.workflowStages`
   - `invokeAgent` **移除所有自動 state 副作用**，完成時 `landed: "pending"`
   - 新增 `saveAgentResult(jobId)` / `discardAgentResult(jobId)`：
     只有 `saveAgentResult` 才把內容落到關卡上；`edit` 關卡才寫 PRD 欄位
   - `approveAndLock` 的行內權限判斷改呼叫 `canSignStage`
6. `src/lib/permissions.ts` + `src/lib/signoff.ts` —— 權限收斂成單一 `canSignStage`；
   agent 族系隔離（同 family 不得核准自己寫的）升格為主要守門
7. 測試：`resolveWorkflow` 五類 × 領域包疊加；`saveAgentResult` 前後 state 不變／變

### Wave 2 — UI（Wave 1 合併後才開，可並行）
- **W2-A**：編輯台「送出審閱」→ 先開**關卡指派對話框**（逐關選 agent 或我），確認才送審
- **W2-B**：簽核頁 agent pop-up —— 跑完跳窗顯示完整全文 + 結論 + 是否存檔；
  `edit` 關卡另顯示「要寫進哪個欄位」的現值 vs 新值；存檔後關卡才出現內容
- **W2-C**：管理中心流程範本檢視／編輯（可延後）

## 不做（本輪）
- 逐條勾選套用的 diff UI（`edit` 關卡先做整段欄位替換 + 前後對照）
- 拆 login / auth / employees 整條線（Scott 明確選了不做）
- 動 `theme` 四層註冊（無關）

## 驗收
- `bunx tsc --noEmit` 乾淨
- `bun test` 全綠（現有 1229 測試不得退步）
- 五類範本 × 五個領域包的 `resolveWorkflow` 有測試覆蓋
- Agent 跑完**不按存檔**時，`state.sectionValues` 與 `state.comments` 逐字不變（測試）

## 進度
- [x] 規格拍板（2026-08-25 23:25）
- [x] Wave 1 資料層（2026-08-26；`bunx tsc --noEmit` exit 0、`bun test` 1563 pass / 0 fail，
      基準 1514 → +49 測試、零退步）
- [ ] Wave 1 Cato 審查
- [ ] Wave 2 UI
- [ ] 實機 UAT

### Wave 1 實作與規格的落差（實作時補的決定）

1. **範本分類要存在專案上。** 規格說「範本分類給骨架」，但 `Project` 原本
   記不得自己套過哪一份整份範本 —— `applyFullTemplate()` 只收章節陣列。
   補了 `Project.templateCat`，由 `applyFullTemplate` 的新參數寫入。
   沒套過整份範本的專案走 `lean`。
2. **`edit` 關卡的落地目標規格沒定義。** 「存檔＝寫進指定的 PRD 欄位」沒說
   指定在哪。補了 `WorkflowStageDef.editTarget`；enterprise 的「文件補完」
   指向 `open.oq` —— 那正是舊版靜默追加摘要的地方，落地目標不變，
   變的是這次會先問過人。
3. **`Template.stages` 的用途規格沒展開。** 依型別加了，並補
   `Project.templateStages` 讓自訂範本的骨架能存活到送審那一刻。
   內建十份範本都沒用到這條路。
4. **個案早在建專案時就開好了。** 規格假設「送審才建個案」，實際上
   `addProject` 就會建一個（走全域預設流程）。所以落地時要判斷個案有沒有
   留下痕跡：沒痕跡的重建，有痕跡的沿用。細節見 `submitForReview`。
5. **規格寫的「現有 1229 測試」是舊數字。** 實測基準為 1514（77 檔）。
