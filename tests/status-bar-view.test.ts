/**
 * 常駐狀態條的路線指示與 gate 摘要（P1-1）。
 *
 * ## 為什麼測的是 `status-bar-view.ts` 而不是 `status-bar.ts`
 *
 * `status-bar.ts` 頂層 import store，而且 module 頂層就跑 `resolveBuildInfo()` ——
 * `bun test` 直接 import 會拖進 localStorage 與 build 環境，全 repo 又沒有 DOM
 * 測試環境。所以「決定顯示什麼字」被搬進純函式，測試網才架得起來。
 *
 * ## 這一份測試在守什麼
 *
 * 1. **中文名不得有第三份對照表。** repo 裡已經有 `prd-file.ts` 的 `ROUTE_LABEL`
 *    與 `editor.ts` 的區域 `NAME` 兩份重複。所以下面每一條路線名都斷言
 *    `=== routeById(...)!.name`，**不寫死中文字串** —— 寫死就等於在測試檔裡
 *    再開第四份對照表，改了 `PRD_ROUTES` 這裡照樣綠。
 * 2. **「結構可送審」不得回來。** 那句話對 vibe（走一鍵自簽不走送審）與已鎖定
 *    專案都是假的，而且描述的是檢查結果不是權限。
 * 3. **gate 文案逐字等於 `gateSummaryLine()`。** 狀態列跟總覽戰情列必須講同一種話。
 */
import { describe, expect, test } from "bun:test";
import type { GateReport } from "../src/lib/gate-rules";
import { gateSummaryLine } from "../src/lib/prd-gates";
import { PRD_ROUTES, routeById } from "../src/lib/prd-triage";
import { gateStatusText, projectNameHtml, routeChipHtml } from "../src/lib/status-bar-view";

/** 路線名的唯一權威。測試不得自己抄一份中文字串。 */
function nameOf(id: string): string {
  const r = routeById(id);
  if (!r) throw new Error(`routeById(${id}) 回 null —— PRD_ROUTES 少了這一檔`);
  return r.name;
}

function report(patch: Partial<GateReport> = {}): GateReport {
  return {
    findings: [],
    blocks: 0,
    warns: 0,
    untouchedBlocks: 0,
    activeBlocks: 0,
    canSubmit: true,
    canApprove: true,
    score: 100,
    ...patch,
  };
}

describe("routeChipHtml —— 四檔路線的中文名", () => {
  test("沒存 route 的舊專案當 full", () => {
    const html = routeChipHtml({});
    expect(html).toContain(nameOf("full"));
  });

  test("full / lite / vibe 各自顯示自己的中文名", () => {
    for (const id of ["full", "lite", "vibe"] as const) {
      const html = routeChipHtml({ route: id });
      expect(html).toContain(nameOf(id));
      // title 也講同一個名字，不是 id
      expect(html).toContain(`title="路線：${nameOf(id)}"`);
      expect(html).not.toContain(`>${id}<`);
    }
  });

  test("三檔的中文名互不相同 —— 顯示的是名稱不是分級", () => {
    const names = new Set(["full", "lite", "vibe"].map(nameOf));
    expect(names.size).toBe(3);
  });

  test("髒值 route 收斂為 full（normalizeRoute 的同一條規則）", () => {
    // 匯入的 JSON / 舊 localStorage 可能帶任何東西。Full 是「看得到全部」，
    // 是錯得最安全的那一邊 —— 猜成 lite 會讓寫好的章節憑空消失。
    for (const dirty of ["ticket", "openspec", "", "FULL", "1", null, undefined]) {
      const html = routeChipHtml({ route: dirty as never });
      expect(html).toContain(nameOf("full"));
    }
  });

  test("沒有專案時整塊消失，不留空欄位或佔位符", () => {
    expect(routeChipHtml(null)).toBe("");
    expect(routeChipHtml(undefined)).toBe("");
  });

  test("vibe 掛 warn 色的 modifier，full / lite 維持中性", () => {
    expect(routeChipHtml({ route: "vibe" })).toContain("app-status-route--vibe");
    expect(routeChipHtml({ route: "full" })).not.toContain("--vibe");
    expect(routeChipHtml({ route: "lite" })).not.toContain("--vibe");
  });

  test("路線籤沿用 .app-status-pill 的尺寸，不自己開一組", () => {
    expect(routeChipHtml({ route: "lite" })).toContain("app-status-pill app-status-route");
  });

  test("輸出零 L0–L4 字樣 —— 顯示的是名稱不是編號", () => {
    for (const id of ["full", "lite", "vibe"] as const) {
      expect(routeChipHtml({ route: id })).not.toMatch(/L[0-4]/);
    }
    // 路線資料本身也不得回頭用編號當名字
    for (const r of PRD_ROUTES) expect(r.name).not.toMatch(/L[0-4]/);
  });
});

describe("projectNameHtml —— 使用者輸入必須逸出", () => {
  test("專案名帶 <script> 不逸出", () => {
    const html = projectNameHtml('<script>alert(1)</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("引號不得逃出 title 屬性", () => {
    const html = projectNameHtml('a" onmouseover="x');
    expect(html).not.toContain('onmouseover="x"');
    expect(html).toContain("&quot;");
  });
});

describe("gateStatusText —— 收斂到 gateSummaryLine 的唯一語彙", () => {
  test("已鎖定", () => {
    expect(gateStatusText({ locked: true, gate: report() })).toEqual({ text: "已鎖定", tone: "ok" });
  });

  test("canSubmit 且零警告 → 逐字等於 gateSummaryLine", () => {
    const r = report({ canSubmit: true, warns: 0 });
    const got = gateStatusText({ locked: false, gate: r });
    expect(got.text).toBe(gateSummaryLine(r));
    expect(got.tone).toBe("ok");
  });

  test("canSubmit 但有警告 → 逐字等於 gateSummaryLine（帶警告數）", () => {
    const r = report({ canSubmit: true, warns: 3 });
    const got = gateStatusText({ locked: false, gate: r });
    expect(got.text).toBe(gateSummaryLine(r));
    expect(got.text).toContain("3");
    expect(got.tone).toBe("ok");
  });

  test("有 blocks → 逐字等於 gateSummaryLine，tone 轉 warn", () => {
    const r = report({ blocks: 2, activeBlocks: 2, untouchedBlocks: 0, warns: 1, canSubmit: false, canApprove: false });
    const got = gateStatusText({ locked: false, gate: r });
    expect(got.text).toBe(gateSummaryLine(r));
    expect(got.tone).toBe("warn");
  });

  test("全未動 → 講「還沒開始」，不是「N 項阻擋」", () => {
    const r = report({ blocks: 5, activeBlocks: 0, untouchedBlocks: 5, canSubmit: false, canApprove: false });
    const got = gateStatusText({ locked: false, gate: r });
    expect(got.text).toBe(gateSummaryLine(r));
    expect(got.text).toContain("還沒開始");
  });

  test("gate === null（非 focus 專案）→ 中欄留白，locked 也不顯示", () => {
    // A 專案的名字配 B 專案的 gate 結果是今天就存在的 bug：evaluatePrdGates 讀的
    // 永遠是 activeProjectId 的內容。不知道就留白，不要猜。
    expect(gateStatusText({ locked: false, gate: null }).text).toBe("");
    expect(gateStatusText({ locked: true, gate: null }).text).toBe("");
  });

  test("「結構可送審」不得出現在任何情境", () => {
    const cases: GateReport[] = [
      report(),
      report({ warns: 2 }),
      report({ blocks: 1, activeBlocks: 1, canSubmit: false, canApprove: false }),
      report({ blocks: 3, untouchedBlocks: 3, activeBlocks: 0, canSubmit: false, canApprove: false }),
    ];
    for (const r of cases) {
      for (const locked of [true, false]) {
        expect(gateStatusText({ locked, gate: r }).text).not.toContain("結構可送審");
      }
    }
  });
});
