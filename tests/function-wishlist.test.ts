import { describe, expect, test } from "bun:test";
import {
  addWish,
  archiveWish,
  briefFromWishes,
  emptyWishlist,
  formatWishId,
  mintWishId,
  nextWishNumber,
  normalizeShortCode,
  occupiedWishNumbers,
  parseWishHandoff,
  parseWishlist,
  removeWish,
  serializeWishlist,
  takeWishId,
  titleFromWishes,
  updateWish,
  wishNumberOf,
  wishlistPath,
  WISH_ARCHIVED_STATUS,
} from "../src/lib/function-wishlist";

const NOW = new Date(2026, 7, 20, 23, 36, 5); // local 2026-08-20 23:36:05

describe("normalizeShortCode", () => {
  test("1–5 個英文字母，存成大寫", () => {
    expect(normalizeShortCode("al")).toBe("AL");
    expect(normalizeShortCode(" SNote ")).toBe("SNOTE");
  });

  test("多一個字、夾數字或符號都拒", () => {
    expect(normalizeShortCode("")).toBeNull();
    expect(normalizeShortCode("ABCDEF")).toBeNull();
    expect(normalizeShortCode("AL1")).toBeNull();
    expect(normalizeShortCode("A-B")).toBeNull();
  });
});

describe("takeWishId", () => {
  test("空清單從 001 起跳", () => {
    expect(takeWishId(emptyWishlist(), "AL")).toBe("AL-001");
  });

  test("已佔用的號跳過，刪掉的號會回來", () => {
    let doc = addWish(emptyWishlist(), "一", "AL-001", NOW)!;
    doc = addWish(doc, "二", "AL-002", NOW)!;
    doc = addWish(doc, "三", "AL-003", NOW)!;
    expect(takeWishId(doc, "al")).toBe("AL-004");
    doc = removeWish(doc, "AL-002")!;
    expect(takeWishId(doc, "AL")).toBe("AL-002");
  });

  test("封存的號仍佔用，不算移除", () => {
    let doc = addWish(emptyWishlist(), "一", "AL-001", NOW)!;
    doc = archiveWish(doc, "AL-001", NOW)!;
    expect(takeWishId(doc, "AL")).toBe("AL-002");
  });

  test("草稿 extra 也佔號，避免連點新增拿到同一個", () => {
    const doc = addWish(emptyWishlist(), "一", "AL-001", NOW)!;
    expect(takeWishId(doc, "AL", ["AL-002"])).toBe("AL-003");
  });

  test("簡寫不合法就不取號", () => {
    expect(takeWishId(emptyWishlist(), "AL1")).toBeNull();
    expect(takeWishId(emptyWishlist(), "")).toBeNull();
  });
});

describe("wishNumberOf / nextWishNumber", () => {
  test("只認目前簡寫加連字號的流水號", () => {
    expect(wishNumberOf("AL-012", "AL")).toBe(12);
    expect(wishNumberOf("AL-001", "AL")).toBe(1);
    expect(wishNumberOf("SNOTE-001", "AL")).toBeNull();
    expect(wishNumberOf("AL1", "AL")).toBeNull();
    expect(wishNumberOf("w-20260820t233605-ab12", "AL")).toBeNull();
  });

  test("最小空洞", () => {
    expect(nextWishNumber([])).toBe(1);
    expect(nextWishNumber([1, 3])).toBe(2);
    expect(nextWishNumber([2])).toBe(1);
  });

  test("formatWishId 是簡寫-三位數", () => {
    expect(formatWishId("SNOTE", 1)).toBe("SNOTE-001");
    expect(formatWishId("SNOTE", 3)).toBe("SNOTE-003");
    expect(formatWishId("SNOTE", 12)).toBe("SNOTE-012");
  });
});

describe("mintWishId", () => {
  test("舊檔案的 heading 形狀仍能 parse（不是新取號）", () => {
    const id = mintWishId(NOW, () => "ab12");
    expect(id).toBe("w-20260820t233605-ab12");
  });
});

describe("wishlistPath", () => {
  test("落點寫死在 .anchorline/function-wishlist.md", () => {
    expect(wishlistPath("/tmp/proj")).toBe("/tmp/proj/.anchorline/function-wishlist.md");
    expect(wishlistPath("/tmp/proj/")).toBe("/tmp/proj/.anchorline/function-wishlist.md");
  });
});

describe("add / update / archive / remove", () => {
  test("空文字不加", () => {
    expect(addWish(emptyWishlist(), "   \n  ", "AL-001")).toBeNull();
  });

  test("重複的號不加", () => {
    const doc = addWish(emptyWishlist(), "一", "AL-001", NOW)!;
    expect(addWish(doc, "二", "AL-001", NOW)).toBeNull();
  });

  test("存檔後出現在 Active，不在 Archive", () => {
    const doc = addWish(emptyWishlist(), "希望側欄能搜尋章節", "AL-001", NOW, "bug")!;
    expect(doc.active).toHaveLength(1);
    expect(doc.active[0]!.id).toBe("AL-001");
    expect(doc.active[0]!.kind).toBe("bug");
    expect(doc.active[0]!.text).toBe("希望側欄能搜尋章節");
    expect(doc.archive).toHaveLength(0);
  });

  test("事後編輯改的是正文，id 不變", () => {
    const added = addWish(emptyWishlist(), "舊的說明", "AL-001", NOW)!;
    const edited = updateWish(added, "AL-001", "新的說明\n第二行")!;
    expect(edited.active[0]!.id).toBe("AL-001");
    expect(edited.active[0]!.text).toBe("新的說明\n第二行");
    expect(edited.active[0]!.text.includes("舊的")).toBe(false);
  });

  test("編輯成空字串被拒，原文還在", () => {
    const added = addWish(emptyWishlist(), "留下", "AL-001", NOW)!;
    expect(updateWish(added, "AL-001", "  ")).toBeNull();
  });

  test("標示已寫 spec 後搬進 Archive，號仍佔用", () => {
    const added = addWish(emptyWishlist(), "要寫進 spec 的功能", "AL-001", NOW)!;
    const archived = archiveWish(added, "AL-001", NOW)!;
    expect(archived.active).toHaveLength(0);
    expect(archived.archive).toHaveLength(1);
    expect(archived.archive[0]!.id).toBe("AL-001");
    expect(archived.archive[0]!.status).toBe(WISH_ARCHIVED_STATUS);
    expect(occupiedWishNumbers(archived, "AL")).toEqual([1]);
  });

  test("移除之後號釋出", () => {
    let doc = addWish(emptyWishlist(), "一", "AL-001", NOW)!;
    doc = removeWish(doc, "AL-001")!;
    expect(doc.active).toHaveLength(0);
    expect(doc.archive).toHaveLength(0);
    expect(takeWishId(doc, "AL")).toBe("AL-001");
  });

  test("不存在的 id 不默默成功", () => {
    expect(archiveWish(emptyWishlist(), "AL-009")).toBeNull();
    expect(updateWish(emptyWishlist(), "AL-009", "x")).toBeNull();
    expect(removeWish(emptyWishlist(), "AL-009")).toBeNull();
  });
});

describe("serialize ↔ parse", () => {
  test("換行正文往返不變", () => {
    let doc = addWish(emptyWishlist(), "第一行\n\n第二段還有空白", "AL-001", NOW)!;
    doc = addWish(doc, "另一則", "AL-002", NOW)!;
    doc = archiveWish(doc, "AL-001", NOW)!;
    const round = parseWishlist(serializeWishlist(doc));
    expect(round.active.map((x) => x.id)).toEqual(["AL-002"]);
    expect(round.archive.map((x) => x.id)).toEqual(["AL-001"]);
    expect(round.active.map((x) => x.text)).toEqual(doc.active.map((x) => x.text));
    expect(round.archive.map((x) => x.text)).toEqual(doc.archive.map((x) => x.text));
    expect(round.archive[0]!.status).toBe(WISH_ARCHIVED_STATUS);
    expect(round.active[0]!.kind).toBe("feature");
    expect(round.archive[0]!.kind).toBe("feature");
  });

  test("空檔是空清單，不是丟錯", () => {
    expect(parseWishlist("")).toEqual(emptyWishlist());
    expect(parseWishlist("   \n")).toEqual(emptyWishlist());
  });

  test("手改檔案時，沒有 ### 的雜訊不會變成一則願望", () => {
    const raw = `# Function wish list

## Active

亂寫一段沒有 id。

### AL-001

created: 2026-08-20T23:36:05

真的願望

## Archive

（沒有）
`;
    const doc = parseWishlist(raw);
    expect(doc.active.map((x) => x.text)).toEqual(["真的願望"]);
    expect(doc.active[0]!.id).toBe("AL-001");
    expect(doc.archive).toEqual([]);
  });

  test("CRLF 不當成正文的一部分", () => {
    const raw = "# Function wish list\r\n\r\n## Active\r\n\r\n### AL-001\r\n\r\ncreated: x\r\n\r\nhello\r\nworld\r\n\r\n## Archive\r\n";
    expect(parseWishlist(raw).active[0]!.text).toBe("hello\nworld");
  });
});

describe("handoff", () => {
  test("標題取第一則第一行，餵給 OpenSpec 當 change 標題", () => {
    expect(titleFromWishes([{ text: "側欄搜尋\n細節在下面" }])).toBe("側欄搜尋");
  });

  test("brief 把勾到的願望編成給模型的清單", () => {
    expect(briefFromWishes([{ text: "A" }, { text: "B" }])).toBe("1. A\n\n2. B");
  });

  test("壞掉的 handoff JSON 是沒有，不是丟錯", () => {
    expect(parseWishHandoff(null)).toBeNull();
    expect(parseWishHandoff("{")).toBeNull();
    expect(parseWishHandoff(JSON.stringify({ projectId: "p", items: [] }))).toBeNull();
    expect(
      parseWishHandoff(JSON.stringify({ projectId: "p", items: [{ id: "AL-001", text: "做這個" }] })),
    ).toEqual({
      projectId: "p",
      kind: "feature",
      items: [{ id: "AL-001", text: "做這個" }],
    });
    expect(
      parseWishHandoff(
        JSON.stringify({
          projectId: "p",
          kind: "bug",
          items: [{ id: "AL-001", text: "修好崩潰", kind: "bug" }],
        }),
      ),
    ).toEqual({
      projectId: "p",
      kind: "bug",
      items: [{ id: "AL-001", text: "修好崩潰", kind: "bug" }],
    });
  });
});
