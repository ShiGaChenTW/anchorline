/**
 * 狀態列的**純渲染邏輯** —— 零 store、零 DOM、零 build 環境。
 *
 * ## 為什麼要獨立成一支
 *
 * `status-bar.ts` 頂層 `import { store }`，而且 module 頂層就跑 `resolveBuildInfo()`。
 * 兩者都需要瀏覽器環境，所以那一支在 `bun test` 裡**根本 import 不進來**——全 repo
 * 沒有 happy-dom、沒有 GlobalRegistrator，104 個測試檔全是純函式 + HTML 字串比對。
 * 狀態列的判斷邏輯留在那裡就等於沒有測試網。
 *
 * 所以「決定顯示什麼字」搬到這裡，`status-bar.ts` 只剩「去哪裡拿資料、塞進哪個節點」。
 *
 * ## 路線名稱只有一個來源
 *
 * 四檔的中文名一律從 `PRD_ROUTES` 查（`routeById`），**不在這裡另建對照表**。
 * repo 裡已經有兩份重複的短名對照（`prd-file.ts` 的 `ROUTE_LABEL`、`editor.ts` 的
 * 區域 `NAME`），第三份的代價是：有人改了卡片名稱，狀態列還在講舊名字，
 * 而且不會有任何錯誤，只有兩個對不起來的名詞。
 */
import { type GateReport, gateSummaryLine } from "./prd-gates";
import { projectRoute, routeById, type ProjectRoute } from "./prd-triage";
import { escapeHtml } from "./ui";

/** 狀態列只需要專案的路線欄位；刻意不收整個 `Project`，維持這一支可獨立測試。 */
export type RouteSource = { route?: ProjectRoute } | null | undefined;

/**
 * 左欄的專案名。
 *
 * 專案名是**使用者輸入**（customName / title / 資料夾名），逸出不是可選項。
 * 放在這一支而不是留在 `status-bar.ts`，唯一理由就是要讓那個逸出有測試網。
 */
export function projectNameHtml(name: string): string {
  return `<span class="app-status-project" title="${escapeHtml(name)}">${escapeHtml(name)}</span>`;
}

/**
 * 路線籤 —— 「這個專案走哪一檔」。
 *
 * 沒有專案時回**空字串**（PRD §11 例外表：沒有 focus 專案時該區塊整塊消失，
 * 不留空欄位也不留佔位符）。顯示的是四檔中文名，不是 id、不是編號。
 *
 * `vibe` 用 warn 色（沿用 `.app-status-pill--review` 的 color-mix 配方結構），
 * `full` / `lite` 維持中性 —— 「最低治理強度」全站同一個色相，P1-2 的自簽語彙
 * 也走這一色。
 *
 * 注意：路線籤**不受 focus 分岔影響**。`route` 是那個專案自己欄位上的值，
 * 跟 `evaluatePrdGates()` 那種「讀的永遠是 activeProjectId 的內容」不同。
 */
export function routeChipHtml(p: RouteSource): string {
  if (p == null) return "";
  const id = projectRoute(p);
  const route = routeById(id);
  if (!route) return "";
  const variant = id === "vibe" ? " app-status-route--vibe" : "";
  const title = `路線：${route.name}`;
  return `<span class="app-status-pill app-status-route${variant}" title="${escapeHtml(title)}">${escapeHtml(route.name)}</span>`;
}

export type GateStatus = { text: string; tone: string };

/**
 * 中欄的結構檢查摘要。
 *
 * ## `gate === null` 是「不知道」，不是「都過了」
 *
 * `evaluatePrdGates()` 讀的是 `state.sectionValues` / `state.sections`，那**永遠是
 * `activeProjectId` 的內容**，不管呼叫端手上拿的是哪個專案。狀態列的
 * `activeProject()` 會在找不到 focus 專案時 fallback 到第一個可見專案 —— 那一刻
 * 顯示的是 A 專案的名字配 B 專案的檢查結果，而且完全不報錯。
 *
 * 處置是不猜：非 focus 時呼叫端傳 `gate: null`，這裡回空字串，中欄留白。
 * `locked` 也一起吞掉（它同樣是 activeProjectId 的狀態），所以 null 檢查排在
 * locked 之前 —— 順序反了就會用別的專案的鎖定狀態去標示這個專案。
 *
 * ## `canSubmit` 沒有自己的文案分支
 *
 * 舊版在 `canSubmit` 時回一句自製的「可以送審了」型文案。刪掉的理由有三個：
 * 那句話對 vibe 路線是假的（vibe 走一鍵自簽，不走送審流程）、對已核准鎖定的
 * 專案也是假的，而且它把**檢查結果**講成了**權限**，狀態列根本沒有權限資訊。
 *
 * `canSubmit === (blocks === 0)`，而 `gateSummaryLine()` 在 `blocks === 0` 時本來
 * 就回「結構檢查通過（N 則建議）」或「結構檢查全部通過」。直接讓 canSubmit 走
 * 同一支，語彙收斂到唯一來源 —— 狀態列跟總覽戰情列從此講同一種話。
 */
export function gateStatusText(input: { locked: boolean; gate: GateReport | null }): GateStatus {
  const { locked, gate } = input;
  if (!gate) return { text: "", tone: "draft" };
  if (locked) return { text: "已鎖定", tone: "ok" };
  // canApprove 保留獨立判斷：領域包可以加更嚴的核准規則，讓它在 canSubmit 為真時
  // 仍為假（見 gate-rules.ts 的 canApprove 註解）。合併成單一條件會靜默吃掉那種設定。
  const tone = gate.canSubmit ? "ok" : gate.canApprove === false ? "warn" : "draft";
  return { text: gateSummaryLine(gate), tone };
}
