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
  renameWishlistCode,
  serializeWishlist,
  takeWishId,
  titleFromWishes,
  updateWish,
  wishNumberOf,
  wishOptionLabel,
  wishlistPath,
  isWishImageName,
  nextWishImageName,
  splitWishText,
  insertAtCaret,
  usedWishImageNames,
  wishImageMarkdown,
  wishImageNamesIn,
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

describe("renameWishlistCode", () => {
  test("active／archive 兩邊都認得的 id 換前綴，流水號不變", () => {
    const doc = {
      active: [
        { id: "AL-001", text: "a", created: "x" },
        { id: "AL-003", text: "b", created: "x" },
      ],
      archive: [{ id: "AL-002", text: "c", created: "x", status: "已寫 spec" }],
    };
    const renamed = renameWishlistCode(doc, "AL", "SNOTE");
    expect(renamed.active.map((it) => it.id)).toEqual(["SNOTE-001", "SNOTE-003"]);
    expect(renamed.archive.map((it) => it.id)).toEqual(["SNOTE-002"]);
  });

  test("不認得舊簡寫的 id（別的專案手動塞進來的）原樣留著", () => {
    const doc = {
      active: [{ id: "OTHER-001", text: "a", created: "x" }],
      archive: [],
    };
    expect(renameWishlistCode(doc, "AL", "SNOTE").active[0]?.id).toBe("OTHER-001");
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

  test("帶入下拉的選項文字：id · 類型 · 正文第一行", () => {
    expect(wishOptionLabel({ id: "AL-001", text: "側欄搜尋\n細節", kind: "feature" })).toBe(
      "AL-001 · 新功能 · 側欄搜尋",
    );
    expect(wishOptionLabel({ id: "SNOTE-002", text: "匯出筆記" , kind: "bug" })).toBe(
      "SNOTE-002 · Bug 修復 · 匯出筆記",
    );
    expect(wishOptionLabel({ id: "X-003", text: "清死碼" })).toBe("X-003 · 未分類 · 清死碼");
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

describe("願望正文裡的截圖", () => {
  test("檔名形狀：願望編號 + 兩位流水號 + 圖片副檔名", () => {
    expect(isWishImageName("ANCHL-002-01.png")).toBe(true);
    expect(isWishImageName("AL-001-12.jpg")).toBe(true);
    expect(isWishImageName("ANCHL-002-01.pdf")).toBe(false);
    expect(isWishImageName("../escape.png")).toBe(false);
    expect(isWishImageName("ANCHL-002.png")).toBe(false);
  });

  test("流水號看整份清單，避免撞到磁碟上的舊檔", () => {
    expect(nextWishImageName("ANCHL-002", [])).toBe("ANCHL-002-01.png");
    expect(
      nextWishImageName("ANCHL-002", ["ANCHL-002-01.png", "ANCHL-001-09.png"], "jpg"),
    ).toBe("ANCHL-002-02.jpg");
    // 認不得的副檔名退回 png，不讓任意字串進檔名
    expect(nextWishImageName("ANCHL-002", [], "exe")).toBe("ANCHL-002-01.png");
  });

  test("usedWishImageNames 掃 Active 與 Archive", () => {
    let doc = addWish(emptyWishlist(), `一\n\n${wishImageMarkdown("AL-001-01.png")}`, "AL-001", NOW)!;
    doc = addWish(doc, `二\n\n${wishImageMarkdown("AL-002-01.png")}`, "AL-002", NOW)!;
    doc = archiveWish(doc, "AL-001", NOW)!;
    expect(usedWishImageNames(doc).sort()).toEqual(["AL-001-01.png", "AL-002-01.png"]);
  });

  test("splitWishText 依正文順序交錯出文字與圖", () => {
    const text = `先看這個\n\n${wishImageMarkdown("AL-001-01.png")}\n\n再看這個\n\n${wishImageMarkdown("AL-001-02.png")}`;
    expect(splitWishText(text)).toEqual([
      { kind: "text", text: "先看這個" },
      { kind: "image", name: "AL-001-01.png", alt: "截圖" },
      { kind: "text", text: "再看這個" },
      { kind: "image", name: "AL-001-02.png", alt: "截圖" },
    ]);
  });

  test("splitWishText 不認得的 ref 當純文字留著", () => {
    const text = "看 ![x](https://example.com/a.png) 這張";
    expect(splitWishText(text)).toEqual([{ kind: "text", text }]);
  });

  test("insertAtCaret 讓圖自己一行，游標停在插入之後", () => {
    const r = insertAtCaret("前面後面", 2, 2, "IMG");
    expect(r.text).toBe("前面\nIMG\n\n後面");
    expect(r.text.slice(0, r.caret)).toBe("前面\nIMG\n\n");
  });

  test("insertAtCaret 連續兩次＝兩張圖照順序排", () => {
    const a = insertAtCaret("說明", 2, 2, "A");
    const b = insertAtCaret(a.text, a.caret, a.caret, "B");
    expect(b.text.indexOf("A")).toBeLessThan(b.text.indexOf("B"));
  });

  test("存進 markdown 再讀回來，圖的 ref 不變", () => {
    const text = `壞掉了\n\n${wishImageMarkdown("AL-001-01.png")}`;
    const doc = addWish(emptyWishlist(), text, "AL-001", NOW)!;
    const back = parseWishlist(serializeWishlist(doc));
    expect(wishImageNamesIn(back.active[0]!.text)).toEqual(["AL-001-01.png"]);
  });
});
