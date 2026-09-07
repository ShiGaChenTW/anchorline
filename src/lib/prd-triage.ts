/**
 * 範本第 0 章「這次要寫哪一種」——四選一的路線表，不是章節。
 * （full／lite／vibe「試作／探索」／openspec —— vibe 是 2026-09 拍板的第四檔，
 * 見 openspec change `add-vibe-route`。）
 *
 * ## 為什麼是三張卡而不是一組勾選
 *
 * 舊版讓使用者勾八條判準、再由 `triage()` 算出 ticket/lite/full。問題是
 * 使用者早就知道自己在做哪一種——他要的是「選一個然後開始」，不是先答一份
 * 問卷再看系統宣判。勾選版還有一個結構性缺點：勾了「按鈕文案」又勾了
 * 「新機制」時，系統得替使用者仲裁，而仲裁規則是看不見的。
 *
 * 三條路線各自完整（名稱／節數／說明／適用情境），使用者直接指認，零仲裁。
 *
 * ## 節數不寫死
 *
 * Full 是「全量」，數字必須等於 `SEED_SECTIONS.length`；Lite 等於
 * `LITE_SECTIONS.length`。寫死數字的下場是有人加了一章、卡片還在說 15 節，
 * 而且不會有任何錯誤——只有一個對不上的數字。
 *
 * 純資料 + 純函式，零 I/O、零 DOM。
 */
import { SEED_SECTIONS } from "../data/seed";

export type RouteId = "full" | "lite" | "vibe" | "openspec";

/**
 * `sections` 三種形狀對應三條路線：
 * `"all"` = 全量章節；陣列 = 只填這幾章；`"none"` = 不寫 PRD，走 OpenSpec。
 */
export type PrdRoute = {
  id: RouteId;
  /** 卡片標題 */
  name: string;
  sections: "all" | readonly string[] | "none";
  /** 說明：這條路線在回答什麼問題 */
  desc: string;
  /** 適用情境，逐條列出讓人指認自己 */
  cases: string[];
  /**
   * 「時機」那一行 —— 什麼時候該選這條路線。
   *
   * 升檔訊號（vibe 卡上的「6 個 change／3 題 UAT 失敗」）**只是靜態文案**：
   * 系統不偵測、不提示，偵測是 P3 的事。把數字寫在卡片上，是讓人自己認得
   * 「該轉正了」的長相，不是承諾系統會替他數。
   */
  timing: string;
};

/** Lite 要填的章節（範本第 0 節的分級 → 對應到本專案的章節 id） */
export const LITE_SECTIONS = ["docinfo", "summary", "problem", "goals", "metrics", "spec", "accept", "open"] as const;

/**
 * 試作／探索要填的章節 —— 一頁意圖：三行摘要、問題、目標。
 *
 * 比 Lite 更少不是偷懶，是這一檔的定義：東西還不確定要不要做，
 * 8 節的空白頁會殺死啟動（PRD §2.2 的 ADHD 機制）。治理不歸零 ——
 * 簽核走一鍵自簽＋錨點，轉正時鏈條接得回去。
 */
export const VIBE_SECTIONS = ["summary", "problem", "goals"] as const;

export const PRD_ROUTES: PrdRoute[] = [
  {
    id: "full",
    name: "新產品／新專案",
    sections: "all",
    desc: "新型需求，需要釐清邏輯",
    cases: [
      "新產品或大型改版（多模組，需要功能地圖與 IA）",
      "新機制：跨流程改寫、新政策或新稽核事件",
    ],
    timing: "動工前想清楚 —— 這種規模的返工比先想貴得多",
  },
  {
    id: "lite",
    name: "功能建構／迭代優化",
    sections: LITE_SECTIONS,
    desc: "既有功能但有迭代新邏輯",
    cases: ["單一功能或迭代需求", "會員制度調整、訂單流程重構"],
    timing: "出現轉折訊號就轉 —— AI 修 A 壞 B、新功能違反既有寫法",
  },
  {
    id: "vibe",
    name: "試作／探索",
    sections: VIBE_SECTIONS,
    desc: "還不確定要不要做 —— 先動手驗證，只留一頁意圖",
    cases: [
      "週末專案、一次性腳本",
      "想法還沒成形，先做了再說",
      "之後可能轉正 —— 治理鏈要接得回去",
    ],
    // 升檔訊號的數字只在這裡（靜態文案）。自動偵測是 P3，不在本檔。
    timing: "動工前 5 分鐘 —— AI 起草你只審；累積 6 個 change 或 3 題 UAT 失敗，就是該升檔的訊號",
  },
  {
    id: "openspec",
    name: "Debug／維運",
    sections: "none",
    desc: "沒有新邏輯要釐清，不必寫 PRD——用 OpenSpec change／plan 記錄就好",
    cases: [
      "前端介面顯示：按鈕調整、文案修正、Tooltips",
      "後端欄位調整：欄位限制、阻擋條件",
      "特殊開關設定",
      "日常維運：壓資料、刪資料",
    ],
    timing: "不寫 PRD —— 一個 change 一份紀錄",
  },
];

const BY_ID = new Map(PRD_ROUTES.map((r) => [r.id, r]));

export function routeById(id: string): PrdRoute | null {
  return BY_ID.get(id as RouteId) ?? null;
}

/** 卡片上的「節數量」那一欄。數字一律從資料算，不寫死。 */
export function routeScaleLabel(route: PrdRoute): string {
  if (route.sections === "none") return "不寫 PRD · 走 OpenSpec";
  if (route.sections === "all") return `Full ${SEED_SECTIONS.length} 節（全量）`;
  // vibe 不講「N 節（簡化）」—— 它的賣點是「一頁」，不是「比較少節」。
  // 欄位數照樣從資料算：VIBE_SECTIONS 多一節，這裡自動跟上。
  if (route.id === "vibe") return `意圖 1 頁 · ${route.sections.length} 欄位`;
  return `Lite ${route.sections.length} 節（簡化）`;
}

// ── 路線 → 看得見哪幾節 ────────────────────────────────────────

/** 專案身上存得下的路線。`openspec` 不建專案，所以不在這裡。 */
export type ProjectRoute = Exclude<RouteId, "openspec">;

/**
 * 沒存路線的專案一律當 `full`。
 *
 * 舊專案是照全量章節寫的 —— 猜成 `lite` 會讓已經寫好的七節在編輯台上
 * 憑空消失，而且沒有任何錯誤訊息，只是東西不見了。
 */
export function projectRoute(p: { route?: ProjectRoute } | null | undefined): ProjectRoute {
  return p?.route === "lite" || p?.route === "vibe" ? p.route : "full";
}

/**
 * 這條路線看得見哪些章節 id。`full` 回 null 代表**全部**。
 *
 * 回 null 而不是回一份完整清單，是因為呼叫端幾乎都在問「要不要濾」——
 * 回清單的話每個呼叫端都得自己判斷「這份清單是不是剛好等於全部」，
 * 而那個判斷在新增章節時會靜默地變成錯的。
 */
export function visibleSectionIds(route: ProjectRoute): ReadonlySet<string> | null {
  if (route === "lite") return new Set<string>(LITE_SECTIONS);
  if (route === "vibe") return new Set<string>(VIBE_SECTIONS);
  return null;
}

/**
 * 這條路線看得見幾節（通用骨架的部分；自訂章節另計）。
 *
 * 升降檔對話框的「保留 X 節、新增 N 節」都從這裡算 —— 寫死數字的下場
 * 跟卡片節數同一種：有人改了章節表，文案還在講舊數字，沒有任何錯誤。
 */
export function routeSectionCount(route: ProjectRoute): number {
  const allow = visibleSectionIds(route);
  return allow ? allow.size : SEED_SECTIONS.length;
}

/**
 * 升檔對話框的種子文案：「試作的 3 節原樣保留，新增 N 節待補」。
 *
 * 升降檔沿用「檢視過濾器，不是資料遷移」—— 已寫正文原封不動，升檔只是
 * 清單上長出新的章節。這句話是那個承諾在對話框上的版本，數字全部從
 * 路線資料算出來。措辭描述**路線**（試作的 3 節）而不是「已寫的」——
 * 三節可能有兩節還空著，「已寫的 3 節」在那個時刻是假話。
 */
export function upgradeSeedText(from: ProjectRoute, to: ProjectRoute): string {
  const kept = routeSectionCount(from);
  const added = routeSectionCount(to) - kept;
  const name = { full: "Full", lite: "Lite", vibe: "試作" }[from];
  // 拉丁字尾接中文助詞要留半形空格（「Lite 的」），中文字尾不用（「試作的」）
  const sep = /[A-Za-z]$/.test(name) ? " " : "";
  return `${name}${sep}的 ${kept} 節原樣保留，新增 ${added} 節待補`;
}

/**
 * 這一節在這條路線底下看得見嗎。
 *
 * **自訂章節永遠看得見。** 它們不在 `SEED_SECTIONS` 裡，也就不在
 * `LITE_SECTIONS` 裡 —— 照白名單濾的話，使用者自己加的章節會在降級時
 * 一起消失，而他從來沒有把那一節歸給任何路線。
 */
export function isSectionVisible(route: ProjectRoute, sectionId: string, isCustom = false): boolean {
  if (isCustom) return true;
  const allow = visibleSectionIds(route);
  return !allow || allow.has(sectionId);
}

/** 降級會藏起來的那幾節（給確認對話框列出來用）。升級不藏任何東西。 */
export function hiddenSectionIds(route: ProjectRoute): string[] {
  const allow = visibleSectionIds(route);
  if (!allow) return [];
  return SEED_SECTIONS.map((s) => s.id).filter((id) => !allow.has(id));
}

/**
 * 從外部資料（localStorage、匯入的 JSON）讀回路線。
 *
 * `migrateProject` 逐欄位重建 Project，而 store 的相依鏈載不進 bun test
 * （`import.meta.glob`），所以那裡的正規化沒有測試網。把判斷搬到這支純函式
 * 才守得住 —— 而它守的是一個實測抓到的洞：漏了這一步，選了 Lite 的專案
 * 重新載入就變回 Full，15 節照樣長出來，沒有任何錯誤。
 *
 * 只認 `"lite"` 與 `"vibe"`：其他任何值（含髒資料）都回 undefined＝Full。
 * Full 是「看得到全部」，是錯得最安全的那一邊。vibe 上路時漏了這裡，
 * 就是 lite 當年那個坑的重演：選了試作的專案重新載入變回 Full、15 節
 * 長出來、沒有任何錯誤。
 */
export function normalizeRoute(raw: unknown): "lite" | "vibe" | undefined {
  return raw === "lite" || raw === "vibe" ? raw : undefined;
}
