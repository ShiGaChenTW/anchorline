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
import { pendingUatsFrom } from "../src/lib/uat-pending";
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
