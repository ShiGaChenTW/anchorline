import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  anchorOf,
  mintId,
  mintMissingIds,
  parsePlanMeta,
  planProgressPct,
  stripAnchor,
} from "../src/lib/plan-parser";

/** 決定性亂數，讓鑄造出來的 id 可預期 */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

const WITH_ANCHORS = `# 測試計劃

**建立時間：** 2026-08-09 01:17
**最後更新：** 2026-08-09 01:17
**狀態：** 進行中

## 目標
測試錨點解析。

## Plan Steps
- [ ] 第一步 <!-- sf:t=HNTPRY5R -->
- [x] 第二步 <!-- sf:t=DSTT1PJ2 -->
- ~~第三步~~ — 不做

## 阻塞 / 待決議
無
`;

const NO_ANCHORS = `# 舊計劃

**狀態：** 進行中

## Plan Steps
- [ ] 沒有錨點的一步
- [x] 也沒有錨點

## 決策紀錄
- 01:00 — 隨便
`;

describe("錨點解析", () => {
  test("有錨點：id 被取出，文字不含註解", () => {
    const m = parsePlanMeta(WITH_ANCHORS);
    expect(m.steps[0]).toEqual({ text: "第一步", state: "pending", id: "HNTPRY5R" });
    expect(m.steps[1]).toEqual({ text: "第二步", state: "done", id: "DSTT1PJ2" });
    expect(m.unanchored).toBe(0);
  });

  test("無錨點：id 為 undefined，unanchored 計數", () => {
    const m = parsePlanMeta(NO_ANCHORS);
    expect(m.steps.every((s) => s.id === undefined)).toBe(true);
    expect(m.unanchored).toBe(2);
  });

  test("放棄的步驟不算 unanchored —— 它不會再產生事件", () => {
    const m = parsePlanMeta(WITH_ANCHORS);
    expect(m.steps[2]!.state).toBe("skipped");
    expect(m.skipped_steps).toBe(1);
    expect(m.unanchored).toBe(0);
  });

  test("錨點被 agent 重寫抹掉 —— 偵測得到，不無聲吞掉", () => {
    const wiped = WITH_ANCHORS.replace(/ <!-- sf:t=\w+ -->/g, "");
    expect(parsePlanMeta(wiped).unanchored).toBe(2);
  });

  test("非法字元（I/L/O/U）不算合法錨點", () => {
    expect(anchorOf("- [ ] x <!-- sf:t=IIIIIIII -->")).toBeUndefined();
    expect(anchorOf("- [ ] x <!-- sf:t=HNTPRY5R -->")).toBe("HNTPRY5R");
  });

  test("stripAnchor 只拿掉註解，不動其他文字", () => {
    expect(stripAnchor("做一件事 <!-- sf:t=HNTPRY5R -->")).toBe("做一件事");
    expect(stripAnchor("沒有錨點")).toBe("沒有錨點");
  });
});

describe("錨點前綴（SpecForge → Anchorline 改名）", () => {
  test("新鑄的用 anc:，不是舊的 sf:", () => {
    const { text } = mintMissingIds("## Plan Steps\n- [ ] 新步驟\n", seeded(1));
    expect(text).toContain("<!-- anc:t=");
    expect(text).not.toContain("sf:t=");
  });

  test("舊的 sf: 錨點仍讀得到 —— 讀不到等於既有事件全變孤兒", () => {
    expect(anchorOf("- [ ] x <!-- sf:t=HNTPRY5R -->")).toBe("HNTPRY5R");
    expect(anchorOf("- [ ] x <!-- anc:t=HNTPRY5R -->")).toBe("HNTPRY5R");
    // 混用也要算數：改名期間同一份 plan 兩種前綴並存是常態
    const mixed = "## Plan Steps\n- [ ] A <!-- sf:t=HNTPRY5R -->\n- [ ] B <!-- anc:t=DSTT1PJ2 -->\n";
    expect(parsePlanMeta(mixed).unanchored).toBe(0);
  });
});

describe("lazy 鑄造", () => {
  test("補上缺的錨點，已有的不動", () => {
    const src = `## Plan Steps\n- [ ] A <!-- sf:t=HNTPRY5R -->\n- [ ] B\n`;
    const { text, minted } = mintMissingIds(src, seeded(1));
    expect(minted).toBe(1);
    expect(text).toContain("A <!-- sf:t=HNTPRY5R -->");
    expect(parsePlanMeta(text).unanchored).toBe(0);
  });

  test("鑄造後再解析：每個步驟都有唯一 id", () => {
    const { text, minted } = mintMissingIds(NO_ANCHORS, seeded(42));
    expect(minted).toBe(2);
    const ids = parsePlanMeta(text).steps.map((s) => s.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("只動 Plan Steps 區段 —— 其他區段的 checkbox 不碰", () => {
    const src = `## Plan Steps\n- [ ] 動我\n\n## 附錄\n- [ ] 別動我\n`;
    const { text, minted } = mintMissingIds(src, seeded(7));
    expect(minted).toBe(1);
    expect(text).toContain("- [ ] 別動我\n");
  });

  test("冪等：跑第二次不再鑄造", () => {
    const once = mintMissingIds(NO_ANCHORS, seeded(9));
    const twice = mintMissingIds(once.text, seeded(9));
    expect(twice.minted).toBe(0);
    expect(twice.text).toBe(once.text);
  });

  test("id 不從文字推導：同樣的文字兩次鑄出不同 id", () => {
    const src = `## Plan Steps\n- [ ] 一模一樣的字\n`;
    const a = mintMissingIds(src, seeded(1)).text;
    const b = mintMissingIds(src, seeded(2)).text;
    expect(anchorOf(a)).not.toBe(anchorOf(b));
  });

  test("mintId 只吐 Crockford base32，長度 8", () => {
    const id = mintId(seeded(3));
    expect(id).toHaveLength(8);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
  });
});

describe("真實 fixture：本專案的實作 task list", () => {
  const path = "plans/Pm-Spec__2026-08-09-0117__dev-workbench-impl.md";
  const text = readFileSync(path, "utf8");
  const meta = parsePlanMeta(text, path);

  test("解析得出標題，狀態落在封閉詞彙內", () => {
    expect(meta.title).toBe("開發專案工作台 — 實作 Task List");
    // 不寫死「進行中」—— 這份 fixture 是活的，工作推進時狀態就會變，
    // 寫死等於每收掉一個階段就紅一次。真正該守的是「解得出來、而且在詞彙表裡」。
    expect(["進行中", "已完成", "已暫停", "已放棄", "阻塞"]).toContain(meta.status);
  });

  test("所有活著的步驟都已有錨點", () => {
    expect(meta.unanchored).toBe(0);
    expect(meta.total_steps).toBeGreaterThan(30);
  });

  test("所有 id 唯一", () => {
    const ids = meta.steps.filter((s) => s.id).map((s) => s.id!);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("進度百分比在合理範圍", () => {
    const pct = planProgressPct(meta);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
  });
});
