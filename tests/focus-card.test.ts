import { describe, expect, test } from "bun:test";
import {
  aheadLabel,
  buildFocusCard,
  FOCUS_FIELD_CAP,
  othersLine,
  pickFocus,
  progressLabel,
  rollupPct,
  type FocusInput,
} from "../src/lib/focus-card";

const NOW = new Date("2026-08-09T10:00:00Z").getTime();

const base: FocusInput = {
  projectId: "p1",
  name: "Anchorline",
  nextStep: "P1-3 單專案焦點卡",
  planPct: 40,
  openspecPct: 60,
  lastActiveIso: "2026-08-09T08:00:00Z",
  ahead: 3,
  unanchored: 0,
  isTracking: true,
};

describe("rollup —— 只在一個地方算", () => {
  test("兩個來源各半", () => {
    expect(rollupPct(40, 60)).toBe(50);
  });

  test("缺一方時另一方佔滿，不是打對折", () => {
    expect(rollupPct(80, null)).toBe(80);
    expect(rollupPct(null, 80)).toBe(80);
  });

  test("兩者皆無回 null —— 0% 是在說謊", () => {
    expect(rollupPct(null, null)).toBeNull();
    expect(progressLabel(null)).toBe("無進度來源");
  });

  test("超出範圍的輸入被夾住", () => {
    expect(rollupPct(150, 150)).toBe(100);
    expect(rollupPct(-20, -20)).toBe(0);
  });

  test("NaN 當成沒有來源，不是 0", () => {
    expect(rollupPct(Number.NaN, null)).toBeNull();
  });
});

describe("焦點卡", () => {
  const card = buildFocusCard(base, NOW);

  test("欄位恰好 4 個 —— 這條測試是欄位上限的執法者", () => {
    expect(card.fields).toHaveLength(FOCUS_FIELD_CAP);
    expect(card.fields.map((f) => f.label)).toEqual(["下一步", "進度", "上次動", "待推"]);
  });

  test("「上次動」用相對時間不用日期（時間盲對策）", () => {
    expect(card.fields[2]!.value).toBe("2 小時前");
  });

  test("超過一週仍然是天數，不退回日期", () => {
    const old = buildFocusCard({ ...base, lastActiveIso: "2026-07-03T10:00:00Z" }, NOW);
    expect(old.fields[2]!.value).toBe("37 天前");
  });

  test("從未活動：不顯示 Invalid Date", () => {
    expect(buildFocusCard({ ...base, lastActiveIso: null }, NOW).fields[2]!.value).toBe("從未");
    expect(buildFocusCard({ ...base, lastActiveIso: "garbage" }, NOW).fields[2]!.value).toBe("從未");
  });

  test("錨點警告透傳", () => {
    expect(buildFocusCard({ ...base, unanchored: 3 }, NOW).unanchored).toBe(3);
  });
});

describe("待推 commit", () => {
  test("-1 是「沒接遠端」，不是 0 —— 兩者意思差很多", () => {
    expect(aheadLabel(-1)).toBe("沒接遠端");
    expect(aheadLabel(0)).toBe("已同步");
    expect(aheadLabel(3)).toBe("3 個待推");
  });
});

describe("挑焦點", () => {
  const mk = (id: string, tracking: boolean, iso: string | null) => ({
    projectId: id,
    isTracking: tracking,
    lastActiveIso: iso,
  });

  test("tracking 優先於最近活動", () => {
    const items = [mk("a", false, "2026-08-09T09:00:00Z"), mk("b", true, "2026-01-01T00:00:00Z")];
    expect(pickFocus(items)!.projectId).toBe("b");
  });

  test("沒有 tracking 就取最近活動", () => {
    const items = [mk("a", false, "2026-08-01T00:00:00Z"), mk("b", false, "2026-08-09T00:00:00Z")];
    expect(pickFocus(items)!.projectId).toBe("b");
  });

  test("空清單回 null，不是空物件", () => {
    expect(pickFocus([])).toBeNull();
  });

  test("永遠只回一個 —— 回陣列的那一刻 UI 就會全畫出來", () => {
    const items = [mk("a", false, null), mk("b", false, null), mk("c", false, null)];
    expect(Array.isArray(pickFocus(items))).toBe(false);
  });
});

describe("其他專案摺疊行", () => {
  test("有其他專案才畫", () => {
    expect(othersLine(4)).toBe("其他 4 個專案 ▸");
    expect(othersLine(0)).toBe("");
  });
});
