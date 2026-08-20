import { describe, expect, test } from "bun:test";
import {
  addWish,
  archiveWish,
  briefFromWishes,
  emptyWishlist,
  mintWishId,
  parseWishHandoff,
  parseWishlist,
  serializeWishlist,
  titleFromWishes,
  updateWish,
  wishlistPath,
  WISH_ARCHIVED_STATUS,
} from "../src/lib/function-wishlist";

const NOW = new Date(2026, 7, 20, 23, 36, 5); // local 2026-08-20 23:36:05

describe("mintWishId", () => {
  test("是檔案 heading 能用的形狀", () => {
    const id = mintWishId(NOW, () => "ab12");
    expect(id).toBe("w-20260820t233605-ab12");
    expect(id).toMatch(/^w-[0-9]{8}t[0-9]{6}-[a-z0-9]+$/);
  });
});

describe("wishlistPath", () => {
  test("落點寫死在 .anchorline/function-wishlist.md", () => {
    expect(wishlistPath("/tmp/proj")).toBe("/tmp/proj/.anchorline/function-wishlist.md");
    expect(wishlistPath("/tmp/proj/")).toBe("/tmp/proj/.anchorline/function-wishlist.md");
  });
});

describe("add / update / archive", () => {
  test("空文字不加", () => {
    expect(addWish(emptyWishlist(), "   \n  ")).toBeNull();
  });

  test("存檔後出現在 Active，不在 Archive", () => {
    const doc = addWish(emptyWishlist(), "希望側欄能搜尋章節", NOW)!;
    expect(doc.active).toHaveLength(1);
    expect(doc.active[0]!.text).toBe("希望側欄能搜尋章節");
    expect(doc.archive).toHaveLength(0);
  });

  test("事後編輯改的是正文，id 不變", () => {
    const added = addWish(emptyWishlist(), "舊的說明", NOW)!;
    const id = added.active[0]!.id;
    const edited = updateWish(added, id, "新的說明\n第二行")!;
    expect(edited.active[0]!.id).toBe(id);
    expect(edited.active[0]!.text).toBe("新的說明\n第二行");
    expect(edited.active[0]!.text.includes("舊的")).toBe(false);
  });

  test("編輯成空字串被拒，原文還在", () => {
    const added = addWish(emptyWishlist(), "留下", NOW)!;
    expect(updateWish(added, added.active[0]!.id, "  ")).toBeNull();
  });

  test("標示已寫 spec 後搬進 Archive", () => {
    const added = addWish(emptyWishlist(), "要寫進 spec 的功能", NOW)!;
    const id = added.active[0]!.id;
    const archived = archiveWish(added, id, NOW)!;
    expect(archived.active).toHaveLength(0);
    expect(archived.archive).toHaveLength(1);
    expect(archived.archive[0]!.id).toBe(id);
    expect(archived.archive[0]!.status).toBe(WISH_ARCHIVED_STATUS);
    expect(archived.archive[0]!.text).toBe("要寫進 spec 的功能");
  });

  test("不存在的 id 不默默成功", () => {
    expect(archiveWish(emptyWishlist(), "w-nope")).toBeNull();
    expect(updateWish(emptyWishlist(), "w-nope", "x")).toBeNull();
  });
});

describe("serialize ↔ parse", () => {
  test("換行正文往返不變", () => {
    let doc = addWish(emptyWishlist(), "第一行\n\n第二段還有空白", NOW)!;
    doc = addWish(doc, "另一則", NOW)!;
    const id = doc.active[0]!.id;
    doc = archiveWish(doc, id, NOW)!;
    const round = parseWishlist(serializeWishlist(doc));
    expect(round.active.map((x) => x.text)).toEqual(doc.active.map((x) => x.text));
    expect(round.archive.map((x) => x.text)).toEqual(doc.archive.map((x) => x.text));
    expect(round.archive[0]!.status).toBe(WISH_ARCHIVED_STATUS);
  });

  test("空檔是空清單，不是丟錯", () => {
    expect(parseWishlist("")).toEqual(emptyWishlist());
    expect(parseWishlist("   \n")).toEqual(emptyWishlist());
  });

  test("手改檔案時，沒有 ### 的雜訊不會變成一則願望", () => {
    const raw = `# Function wish list

## Active

亂寫一段沒有 id。

### w-ok-1

created: 2026-08-20T23:36:05

真的願望

## Archive

（沒有）
`;
    const doc = parseWishlist(raw);
    expect(doc.active.map((x) => x.text)).toEqual(["真的願望"]);
    expect(doc.archive).toEqual([]);
  });

  test("CRLF 不當成正文的一部分", () => {
    const raw = "# Function wish list\r\n\r\n## Active\r\n\r\n### w-1\r\n\r\ncreated: x\r\n\r\nhello\r\nworld\r\n\r\n## Archive\r\n";
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
      parseWishHandoff(JSON.stringify({ projectId: "p", items: [{ id: "w-1", text: "做這個" }] })),
    ).toEqual({ projectId: "p", items: [{ id: "w-1", text: "做這個" }] });
  });
});
