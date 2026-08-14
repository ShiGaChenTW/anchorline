/**
 * `pendingUatsFrom` —— 「有幾份報告在等我動手」的唯一判定。
 *
 * 這個函式同時餵給總覽的「待實測」區塊與側欄 badge，所以它錯的話，
 * 症狀是兩個地方一起說謊（而且說的是同一個謊，看起來很像是對的）。
 * 每個案例釘的都是一條會讓數字虛胖的路：openspec 的 tasks.md、
 * 已完成的報告、一題錨點都沒有的遺留檔。
 *
 * 放 tests/ 而非 src/ 的理由同 tracking-bridge.test.ts：tsconfig 的 include 是 `src/**`。
 */
import { describe, expect, test } from "bun:test";
import { attributePendingUats, openFixesFrom, pendingUatsFrom } from "../src/lib/uat-pending";
import type { ScannedPlan } from "../src/lib/tracking-bridge";

/** 一份最小的實測報告。verdicts 逐題給，長度就是題數。 */
function report(title: string, verdicts: string[], opts: { anchors?: boolean } = {}): string {
  const anchored = opts.anchors !== false;
  const head = [`# UAT: ${title}`, "", "**狀態：** 進行中", ""];
  const items = verdicts.flatMap((v, i) => [
    `## T${i + 1} 題目${i + 1}${anchored ? ` <!-- anc:t=AAAA${i} -->` : ""}`,
    "",
    "**流程：**",
    "1. 做一件事",
    "",
    "**預期：**",
    "看到某個結果",
    "",
    `**結果：** ${v}`,
    "",
    "**說明：**",
    v === "失敗" || v === "不測" ? "有原因" : "（無）",
    "",
  ]);
  return [...head, ...items].join("\n");
}

function file(name: string, text: string, extra: Partial<ScannedPlan> = {}): ScannedPlan {
  return { path: `/w/proj/plans/${name}`, name, mtimeMs: 1000, text, ...extra };
}

describe("pendingUatsFrom", () => {
  test("進行中且有錨點的報告會列出來，進度與 uatProgress 同源", () => {
    const files = [file("uat-a.md", report("結帳流程", ["通過", "未測", "失敗"]))];
    const out = pendingUatsFrom(files);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("結帳流程");
    // 「已結」= 任何非未測的結果，所以是 2/3 而不是 1/3
    expect(out[0]!.closed).toBe(2);
    expect(out[0]!.total).toBe(3);
    expect(out[0]!.path).toBe("/w/proj/plans/uat-a.md");
  });

  test("全部測完的報告不算待實測", () => {
    const files = [file("uat-done.md", report("測完了", ["通過", "暫時跳過"]))];
    expect(pendingUatsFrom(files)).toEqual([]);
  });

  test("一題錨點都沒有的檔不算 —— 它勾不了，列進待辦等於給一個做不了的事", () => {
    const files = [
      file("uat-legacy.md", report("表格版", ["未測", "未測"], { anchors: false })),
    ];
    expect(pendingUatsFrom(files)).toEqual([]);
  });

  test("openspec 的 tasks.md 一律排除，即使內文長得像 UAT", () => {
    const files = [
      file("tasks.md", report("不該出現", ["未測"]), { kind: "openspec", change: "add-x" }),
    ];
    expect(pendingUatsFrom(files)).toEqual([]);
  });

  test("普通 plan 檔不算", () => {
    const files = [
      file("2026-08-14_something.md", "# 一般計劃\n\n## Plan Steps\n- [ ] 一步 <!-- anc:t=BBBB1 -->\n"),
    ];
    expect(pendingUatsFrom(files)).toEqual([]);
  });

  test("檔名 uat- 開頭但 H1 不是 `# UAT:` 也收 —— 與 tracking 頁的方言判定一致", () => {
    const text = report("手寫的", ["未測"]).replace("# UAT: 手寫的", "# 手寫的實測");
    expect(pendingUatsFrom([file("uat-hand.md", text)])).toHaveLength(1);
  });

  test("最近動過的排前面", () => {
    const files = [
      file("uat-old.md", report("舊的", ["未測"]), { mtimeMs: 100 }),
      file("uat-new.md", report("新的", ["未測"]), { mtimeMs: 900 }),
    ];
    expect(pendingUatsFrom(files).map((x) => x.name)).toEqual(["uat-new.md", "uat-old.md"]);
  });

  test("空清單不會爆", () => {
    expect(pendingUatsFrom([])).toEqual([]);
  });
});

describe("重測輪次 supersede（W2-3）", () => {
  const OLD = "uat-舊輪.md";
  const NEW = "uat-新輪.md";
  const supersedeLine = (p: string) => `> 重測自：${p}\n`;

  function reportWithPreamble(title: string, preamble: string, verdicts: string[]): string {
    const base = report(title, verdicts);
    // preamble 插在狀態行之後、第一題之前
    return base.replace("**狀態：** 進行中\n", `**狀態：** 進行中\n\n${preamble}`);
  }

  test("新一輪指到舊報告 → 舊報告踢出待辦，新報告留著", () => {
    const oldFile = file(OLD, report("舊輪", ["未測", "未測"]));
    const newFile = file(
      NEW,
      reportWithPreamble("新輪", supersedeLine(`/w/proj/plans/${OLD}`), ["未測"]),
    );
    const got = pendingUatsFrom([oldFile, newFile]);
    expect(got.map((x) => x.name)).toEqual([NEW]);
  });

  test("取代者自己已測完，舊報告一樣被踢——新一輪存在即取代", () => {
    const oldFile = file(OLD, report("舊輪", ["未測"]));
    const newFile = file(
      NEW,
      reportWithPreamble("新輪", supersedeLine(`/w/proj/plans/${OLD}`), ["通過"]),
    );
    expect(pendingUatsFrom([oldFile, newFile]).map((x) => x.name)).toEqual([]);
  });

  test("/tmp 與 /private/tmp 指同一份檔 → 仍然對得上", () => {
    const oldFile = file(OLD, report("舊輪", ["未測"]), {
      path: `/private/tmp/proj/plans/${OLD}`,
    });
    const newFile = file(
      NEW,
      reportWithPreamble("新輪", supersedeLine(`/tmp/proj/plans/${OLD}`), ["未測"]),
    );
    expect(pendingUatsFrom([oldFile, newFile]).map((x) => x.name)).toEqual([NEW]);
  });

  test("NFD 路徑（macOS 檔案系統回報）對 NFC 標記 → 仍然對得上", () => {
    const nfdName = "uat-é.md"; // e + 結合重音（NFD）
    const nfcName = "uat-é.md"; // é 合成形（NFC）
    const oldFile = file(nfdName, report("舊輪", ["未測"]), {
      path: `/w/proj/plans/${nfdName}`,
    });
    const newFile = file(
      NEW,
      reportWithPreamble("新輪", supersedeLine(`/w/proj/plans/${nfcName}`), ["未測"]),
    );
    expect(pendingUatsFrom([oldFile, newFile]).map((x) => x.name)).toEqual([NEW]);
  });

  test("標記指到不存在的檔 → 不影響任何現存報告", () => {
    const a = file("uat-a.md", report("A", ["未測"]));
    const b = file(
      NEW,
      reportWithPreamble("新輪", supersedeLine("/w/proj/plans/uat-不存在.md"), ["未測"]),
    );
    expect(pendingUatsFrom([a, b]).map((x) => x.name).sort()).toEqual([NEW, "uat-a.md"].sort());
  });

  test("沒有標記 → 兩輪並存都算待辦（現狀行為，不誤殺）", () => {
    const a = file("uat-a.md", report("A", ["未測"]));
    const b = file("uat-b.md", report("B", ["未測"]));
    expect(pendingUatsFrom([a, b]).length).toBe(2);
  });
});

/**
 * 跨專案歸屬（W2-1）。
 *
 * 收件匣現在掃全部專案，所以每一列都得回答「這是誰家的報告」——
 * 答不出來的話，使用者看到的是一排來歷不明的標題。歸屬只靠 rootPath 前綴，
 * 與 tracking 頁的 `alignProjectForUat` 同一條規則：兩邊分岔的症狀是
 * 「總覽說這是 A 專案的，點進去卻切到 B」。
 */
describe("attributePendingUats（W2-1 跨專案歸屬）", () => {
  const uat = (path: string): ReturnType<typeof pendingUatsFrom>[number] => ({
    path,
    name: path.split("/").pop()!,
    title: "某份報告",
    closed: 0,
    total: 1,
    mtimeMs: 1000,
  });

  const ref = (id: string, name: string, rootPath?: string) => ({ id, name, rootPath });

  test("依 rootPath 前綴歸屬，其餘欄位原封不動", () => {
    const list = [uat("/w/beta/plans/uat-b.md")];
    const got = attributePendingUats(list, [
      ref("a", "阿爾法", "/w/alpha"),
      ref("b", "貝塔", "/w/beta"),
    ]);
    expect(got[0]!.projectId).toBe("b");
    expect(got[0]!.projectName).toBe("貝塔");
    // 歸屬只加欄位，不重算進度／標題 —— 那些是 pendingUatsFrom 的責任
    expect(got[0]!.path).toBe("/w/beta/plans/uat-b.md");
    expect(got[0]!.total).toBe(1);
  });

  test("前綴對不到任何專案 → 兩個欄位都留空", () => {
    // 留空而不是猜一個：猜錯的專案名會讓人以為報告屬於別人，比沒有名字更糟。
    const got = attributePendingUats(
      [uat("/somewhere/else/plans/uat-x.md")],
      [ref("a", "阿爾法", "/w/alpha")],
    );
    expect(got[0]!.projectId).toBeUndefined();
    expect(got[0]!.projectName).toBeUndefined();
  });

  test("兄弟目錄不誤判：/w/alpha 吃不到 /w/alpha-2 的報告", () => {
    // 純字串 startsWith(root) 會讓前綴相同的鄰居互相吃單，所以比的是 `root + "/"`。
    const got = attributePendingUats(
      [uat("/w/alpha-2/plans/uat-x.md")],
      [ref("a", "阿爾法", "/w/alpha"), ref("a2", "阿爾法二號", "/w/alpha-2")],
    );
    expect(got[0]!.projectId).toBe("a2");
  });

  test("巢狀專案取最長的相符 root，不看陣列順序", () => {
    // monorepo 底下再匯入子專案時會出現這種配置。取第一個相符的話，
    // 歸屬會變成「看 store 裡誰先被匯入」—— 等於隨機。
    const got = attributePendingUats(
      [uat("/w/mono/sub/plans/uat-x.md")],
      [ref("mono", "母專案", "/w/mono"), ref("sub", "子專案", "/w/mono/sub")],
    );
    expect(got[0]!.projectId).toBe("sub");
  });

  test("rootPath 尾端有斜線也對得上", () => {
    const got = attributePendingUats(
      [uat("/w/alpha/plans/uat-x.md")],
      [ref("a", "阿爾法", "/w/alpha//")],
    );
    expect(got[0]!.projectId).toBe("a");
  });

  test("NFD 報告路徑對 NFC 專案根目錄 → 仍然對得上", () => {
    // 掃描回來的路徑來自檔案系統（macOS 慣用 NFD），專案根目錄來自匯入時
    // 存進 store 的字串。兩邊正規化形式不同時，症狀是「明明是這個專案的報告，
    // 卻沒有專案名」—— 沒有錯誤訊息，只是欄位空著。
    const nfd = "/w/資料é夾/plans/uat-x.md"; // e + 結合重音
    const nfc = "/w/資料é夾"; // é 合成形
    const got = attributePendingUats([uat(nfd)], [ref("a", "重音專案", nfc)]);
    expect(got[0]!.projectId).toBe("a");
  });

  test("/private/tmp 報告對 /tmp 專案根目錄 → 仍然對得上", () => {
    // 與 supersede 過濾用的是同一條正規化，理由也同一個：symlink 走不走
    // 決定於誰產生那個字串，而使用者不該為此看到一份沒有歸屬的報告。
    const got = attributePendingUats(
      [uat("/private/tmp/proj/plans/uat-x.md")],
      [ref("a", "臨時專案", "/tmp/proj")],
    );
    expect(got[0]!.projectId).toBe("a");
  });

  test("沒綁資料夾的專案不會吃掉任何報告", () => {
    const got = attributePendingUats(
      [uat("/w/alpha/plans/uat-x.md")],
      [ref("noroot", "沒綁資料夾"), ref("a", "阿爾法", "/w/alpha")],
    );
    expect(got[0]!.projectId).toBe("a");
  });

  test("空專案清單 → 全部留空，不會爆", () => {
    const got = attributePendingUats([uat("/w/alpha/plans/uat-x.md")], []);
    expect(got).toHaveLength(1);
    expect(got[0]!.projectName).toBeUndefined();
  });

  test("不改動傳進來的陣列與元素（純函式）", () => {
    const list = [uat("/w/alpha/plans/uat-x.md")];
    attributePendingUats(list, [ref("a", "阿爾法", "/w/alpha")]);
    expect(list[0]!.projectId).toBeUndefined();
  });

  test("與 supersede 過濾串起來：活下來的那份帶著正確專案名", () => {
    // 兩段各自對，串起來錯，是最難查的一種：badge 的數字對得上，
    // 但列上的專案名是被取代那一輪的。
    const OLD = "uat-舊輪.md";
    const oldFile = file(OLD, report("舊輪", ["未測"]), {
      path: `/w/beta/plans/${OLD}`,
    });
    const newText = report("新輪", ["未測"]).replace(
      "**狀態：** 進行中\n",
      `**狀態：** 進行中\n\n> 重測自：/w/beta/plans/${OLD}\n`,
    );
    const newFile = file("uat-新輪.md", newText, { path: "/w/beta/plans/uat-新輪.md" });

    const got = attributePendingUats(pendingUatsFrom([oldFile, newFile]), [
      ref("a", "阿爾法", "/w/alpha"),
      ref("b", "貝塔", "/w/beta"),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]!.title).toBe("新輪");
    expect(got[0]!.projectName).toBe("貝塔");
  });
});

describe("待修視圖 openFixesFrom（W2-4）", () => {
  function reportWithFail(title: string, opts: { failNote?: string; extra?: string[] } = {}): string {
    return [
      `# UAT: ${title}`,
      "",
      "**狀態：** 進行中",
      "",
      ...(opts.extra ?? []),
      "## T1 失敗的題 <!-- anc:t=FAIL0001 -->",
      "",
      "**流程：**",
      "1. 步",
      "",
      "**預期：**",
      "果",
      "",
      "**結果：** 失敗",
      "",
      "**說明：**",
      opts.failNote ?? "壞掉的原因",
      "",
      "## T2 通過的題 <!-- anc:t=PASS0001 -->",
      "",
      "**流程：**",
      "1. 步",
      "",
      "**預期：**",
      "果",
      "",
      "**結果：** 通過",
      "",
      "**說明：**",
      "（無）",
      "",
    ].join("\n");
  }

  test("只收失敗題；通過／未測不列", () => {
    const got = openFixesFrom([file("uat-a.md", reportWithFail("A"))]);
    expect(got.length).toBe(1);
    expect(got[0]!.itemTitle).toContain("失敗的題");
    expect(got[0]!.note).toBe("壞掉的原因");
  });

  test("已收工（全題已結）的報告，失敗題仍算欠修——收工結束的是測試輪不是債", () => {
    // 全題已結（失敗＋通過）→ 報告推導為已完成，但失敗題還在
    const got = openFixesFrom([file("uat-b.md", reportWithFail("B"))]);
    expect(got.length).toBe(1);
  });

  test("被 supersede 的報告整檔退場——以最新一輪為準", () => {
    const oldFile = file("uat-old.md", reportWithFail("舊輪"));
    const newFile = file(
      "uat-new.md",
      reportWithFail("新輪", { extra: ["> 重測自：/w/proj/plans/uat-old.md", ""] }),
    );
    const got = openFixesFrom([oldFile, newFile]);
    expect(got.length).toBe(1);
    expect(got[0]!.name).toBe("uat-new.md");
  });

  test("attributePendingUats 泛型化後也能歸屬待修列", () => {
    const got = attributePendingUats(
      openFixesFrom([file("uat-a.md", reportWithFail("A"))]),
      [{ id: "p1", name: "專案一", rootPath: "/w/proj" }],
    );
    expect(got[0]!.projectId).toBe("p1");
    expect(got[0]!.projectName).toBe("專案一");
  });
});
