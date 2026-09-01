/**
 * 範本第 0 章「這次要寫哪一種」——三選一的路線表，不是章節。
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

export type RouteId = "full" | "lite" | "openspec";

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
};

/** Lite 要填的章節（範本第 0 節的分級 → 對應到本專案的章節 id） */
export const LITE_SECTIONS = ["docinfo", "summary", "problem", "goals", "metrics", "spec", "accept", "open"] as const;

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
  },
  {
    id: "lite",
    name: "功能建構／迭代優化",
    sections: LITE_SECTIONS,
    desc: "既有功能但有迭代新邏輯",
    cases: ["單一功能或迭代需求", "會員制度調整、訂單流程重構"],
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
  return `Lite ${route.sections.length} 節（簡化）`;
}
