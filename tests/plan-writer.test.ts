import { describe, expect, test } from "bun:test";
import { parsePlanMeta } from "../src/lib/plan-parser";
import {
  anchorsOf,
  appendStep,
  detectConflict,
  guardOf,
  hashText,
  safeApply,
  toggleStep,
} from "../src/lib/plan-writer";

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

const PLAN = `# 測試

**狀態：** 進行中

## Plan Steps

- [ ] 第一步 <!-- sf:t=HNTPRY5R -->
- [x] 第二步 <!-- sf:t=DSTT1PJ2 -->

## 決策紀錄

- 01:00 — 隨便
`;

describe("勾選：只動那一行的方框", () => {
  test("勾起來", () => {
    const out = toggleStep(PLAN, "HNTPRY5R", true);
    expect(parsePlanMeta(out).steps[0]!.state).toBe("done");
  });

  test("取消勾", () => {
    const out = toggleStep(PLAN, "DSTT1PJ2", false);
    expect(parsePlanMeta(out).steps[1]!.state).toBe("pending");
  });

  test("其餘一字不改 —— 縮排、註解、空行都是使用者的東西", () => {
    const out = toggleStep(PLAN, "HNTPRY5R", true);
    const a = PLAN.split("\n");
    const b = out.split("\n");
    expect(b.length).toBe(a.length);
    const diff = a.map((l, i) => (l === b[i] ? null : i)).filter((x) => x !== null);
    expect(diff).toHaveLength(1);
  });

  test("找不到那個 id 就原樣回傳，不亂改", () => {
    expect(toggleStep(PLAN, "NOSUCHID", true)).toBe(PLAN);
  });

  test("錨點在但不是 checkbox 行 —— 不動", () => {
    const txt = `## Plan Steps\n\n一段文字 <!-- sf:t=HNTPRY5R -->\n`;
    expect(toggleStep(txt, "HNTPRY5R", true)).toBe(txt);
  });
});

describe("新增步驟", () => {
  test("加在 Plan Steps 末尾並鑄錨點", () => {
    const r = appendStep(PLAN, "第三步", seeded(1))!;
    const meta = parsePlanMeta(r.text);
    expect(meta.steps).toHaveLength(3);
    expect(meta.steps[2]!.text).toBe("第三步");
    expect(meta.steps[2]!.id).toBe(r.id);
    expect(meta.unanchored).toBe(0);
  });

  test("不會掉進下一個區段 —— 決策紀錄還在原位", () => {
    const r = appendStep(PLAN, "第三步", seeded(2))!;
    expect(r.text.indexOf("第三步")).toBeLessThan(r.text.indexOf("## 決策紀錄"));
  });

  test("id 不與既有錨點碰撞", () => {
    const r = appendStep(PLAN, "x", seeded(3))!;
    const all = anchorsOf(r.text);
    expect(new Set(all).size).toBe(all.length);
  });

  test("沒有 Plan Steps 區段就回 null，不硬塞到檔尾", () => {
    expect(appendStep("# 只有標題\n\n## 別的\n", "x", seeded(4))).toBeNull();
  });
});

describe("併發保護 —— 這是整個檔存在的理由", () => {
  test("內容沒變：放行", () => {
    expect(detectConflict(guardOf("p", PLAN), PLAN)).toBeNull();
  });

  test("agent 加了步驟：擋下，而且說得出加了幾個", () => {
    const fresh = appendStep(PLAN, "agent 加的", seeded(9))!.text;
    const msg = detectConflict(guardOf("p", PLAN), fresh);
    expect(msg).toContain("新增 1 個步驟");
  });

  test("agent 刪了步驟：擋下並說明", () => {
    const fresh = PLAN.replace("- [x] 第二步 <!-- sf:t=DSTT1PJ2 -->\n", "");
    expect(detectConflict(guardOf("p", PLAN), fresh)).toContain("移除 1 個步驟");
  });

  test("錨點沒變但內文被改：一樣擋下 —— 雜湊比錨點集合更嚴", () => {
    const fresh = PLAN.replace("第一步", "第一步（agent 改寫過）");
    const msg = detectConflict(guardOf("p", PLAN), fresh);
    expect(msg).toBeTruthy();
    expect(msg).toContain("內容在你編輯期間被改過");
  });

  test("雜湊對相同輸入穩定、對不同輸入不同", () => {
    expect(hashText(PLAN)).toBe(hashText(PLAN));
    expect(hashText(PLAN)).not.toBe(hashText(PLAN + " "));
  });
});

describe("safeApply", () => {
  const io = (initial: string) => {
    const box = { text: initial, writes: 0 };
    return {
      box,
      io: {
        read: async () => box.text,
        write: async (_p: string, t: string) => {
          box.text = t;
          box.writes++;
        },
      },
    };
  };

  test("正常路徑：寫進去", async () => {
    const { box, io: h } = io(PLAN);
    const r = await safeApply(guardOf("p", PLAN), (t) => toggleStep(t, "HNTPRY5R", true), h);
    expect(r.ok).toBe(true);
    expect(box.writes).toBe(1);
    expect(parsePlanMeta(box.text).steps[0]!.state).toBe("done");
  });

  test("磁碟上已被改過：擋下，而且一個位元組都沒寫", async () => {
    const { box, io: h } = io(PLAN);
    // 模擬 agent 在我們讀完之後動了檔案
    const stale = guardOf("p", PLAN);
    box.text = appendStep(PLAN, "agent 剛加的", seeded(5))!.text;
    const before = box.text;

    const r = await safeApply(stale, (t) => toggleStep(t, "HNTPRY5R", true), h);
    expect(r.ok).toBe(false);
    expect(box.writes).toBe(0);
    expect(box.text).toBe(before);
    if (!r.ok) expect(r.reason).toContain("被改過");
  });

  test("讀取失敗不會變成寫入", async () => {
    const r = await safeApply(
      guardOf("p", PLAN),
      (t) => t,
      {
        read: async () => {
          throw new Error("boom");
        },
        write: async () => {
          throw new Error("不該被呼叫");
        },
      }
    );
    expect(r.ok).toBe(false);
  });

  test("沒有變更時不寫檔", async () => {
    const { box, io: h } = io(PLAN);
    const r = await safeApply(guardOf("p", PLAN), (t) => toggleStep(t, "NOPE", true), h);
    expect(r.ok).toBe(false);
    expect(box.writes).toBe(0);
  });

  test("找不到 Plan Steps 區段時的訊息說得出原因", async () => {
    const src = "# 沒有步驟區段\n";
    const { io: h } = io(src);
    const r = await safeApply(guardOf("p", src), (t) => appendStep(t, "x")?.text ?? null, h);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("Plan Steps");
  });
});
