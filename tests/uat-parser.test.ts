import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import {
  isUatText,
  parseUatReport,
  serializeUatReport,
  setVerdict,
  validateUatSpec,
} from "../src/lib/uat-parser";

function mintFrom(ids: string[]): () => string {
  let i = 0;
  return () => ids[i++]!;
}

function locateSection(lines: string[], id: string): { start: number; end: number } {
  const start = lines.findIndex((line) => line.includes(`anc:t=${id}`));
  if (start < 0) throw new Error(`missing section ${id}`);
  const end = lines.findIndex(
    (line, i) => i > start && line.trim().startsWith("## "),
  );
  return { start, end: end < 0 ? lines.length : end };
}

function locateLine(
  lines: string[],
  predicate: (line: string, index: number) => boolean,
  range?: { start: number; end: number },
): number {
  const start = range?.start ?? 0;
  const end = range?.end ?? lines.length;
  for (let i = start; i < end; i++) {
    if (predicate(lines[i]!, i)) return i;
  }
  throw new Error("line not found");
}

function baseReport() {
  return serializeUatReport(
    {
      title: "登入與送出",
      items: [
        {
          title: "登入頁能正常登入",
          steps: ["開啟登入頁", "輸入正確帳密", "按下登入"],
          expected: "成功進入 dashboard",
        },
        {
          title: "送出前會顯示確認視窗",
          steps: ["編輯資料", "按下送出"],
          expected: "跳出確認視窗，且主畫面不先消失",
        },
        {
          title: "最後一題也能穩定回寫",
          steps: ["開啟最後一題", "回填結果"],
          expected: "最後一題的區段結構維持穩定",
        },
      ],
    },
    {
      now: "2026-08-14 12:34:56 +08:00",
      mint: mintFrom(["AAAA1111", "BBBB2222", "CCCC3333"]),
    },
  );
}

function handWrittenReport(): string {
  return [
    "# UAT: 手寫檔",
    "",
    "**建立時間：** 2026-08-14",
    "**最後更新：** 2026-08-14",
    "**狀態：** 進行中",
    "",
    "## T1 第一題 <!-- anc:t=A1B2 -->",
    "",
    "**流程：** 1. 點登入",
    "- 再點一次",
    "",
    "**預期：** 成功登入",
    "並且看到 dashboard",
    "",
    "**結果：** 通過（2026-08-14）",
    "",
    "**說明：** 因為超時前已修好",
    "",
    "## T2 第二題",
    "",
    "**流程：**",
    "1. 沒有錨點也要算出來",
    "",
    "**預期：** 要能提醒 UI 這題勾不了",
    "",
    "**結果：** pending",
    "",
    "**說明：**",
    "（無）",
    "",
  ].join("\n");
}

describe("UAT parser：讀得回來，也守得住寫回邊界", () => {
  test("序列化再解析 —— 標題保留 T1 前綴，流程／預期／結果／說明都要對上", () => {
    const initial = baseReport();
    const step1 = setVerdict(initial, "AAAA1111", "pass", "", {
      now: "2026-08-14 12:40:00 +08:00",
    });
    expect(step1.ok).toBe(true);
    if (!step1.ok) return;

    const step2 = setVerdict(step1.text, "BBBB2222", "fail", "因為 API timeout", {
      now: "2026-08-14 12:41:00 +08:00",
    });
    expect(step2.ok).toBe(true);
    if (!step2.ok) return;

    const parsed = parseUatReport(step2.text);
    expect(parsed.title).toBe("登入與送出");
    expect(parsed.items).toHaveLength(3);
    expect(parsed.items[0]).toMatchObject({
      id: "AAAA1111",
      title: "T1 登入頁能正常登入",
      steps: ["開啟登入頁", "輸入正確帳密", "按下登入"],
      expected: "成功進入 dashboard",
      verdict: "pass",
      note: "",
    });
    expect(parsed.items[1]).toMatchObject({
      id: "BBBB2222",
      title: "T2 送出前會顯示確認視窗",
      steps: ["編輯資料", "按下送出"],
      expected: "跳出確認視窗，且主畫面不先消失",
      verdict: "fail",
      note: "因為 API timeout",
    });
    expect(parsed.items[2]).toMatchObject({
      id: "CCCC3333",
      title: "T3 最後一題也能穩定回寫",
      steps: ["開啟最後一題", "回填結果"],
      expected: "最後一題的區段結構維持穩定",
      verdict: "pending",
      note: "",
    });
  });

  test("手寫 inline 內容不會被吞掉 —— 標籤後面直接寫字也是合法檔案", () => {
    const parsed = parseUatReport(handWrittenReport());
    expect(parsed.items[0]).toMatchObject({
      steps: ["點登入", "再點一次"],
      expected: "成功登入\n並且看到 dashboard",
      verdict: "pass",
      note: "因為超時前已修好",
    });
  });

  test("中英結果詞都收；看不懂的一律退回 pending，這是安全退避不是隨便猜", () => {
    const text = [
      "# UAT: verdicts",
      "",
      "**建立時間：** 2026-08-14",
      "**最後更新：** 2026-08-14",
      "**狀態：** 進行中",
      "",
      "## T1 一 <!-- anc:t=V1 -->",
      "",
      "**流程：**",
      "1. x",
      "",
      "**預期：** y",
      "",
      "**結果：** 通過（2026-08-14）",
      "",
      "**說明：**",
      "（無）",
      "",
      "## T2 二 <!-- anc:t=V2 -->",
      "",
      "**流程：**",
      "1. x",
      "",
      "**預期：** y",
      "",
      "**結果：** 失敗",
      "",
      "**說明：**",
      "原因",
      "",
      "## T3 三 <!-- anc:t=V3 -->",
      "",
      "**流程：**",
      "1. x",
      "",
      "**預期：** y",
      "",
      "**結果：** 不測",
      "",
      "**說明：**",
      "原因",
      "",
      "## T4 四 <!-- anc:t=V4 -->",
      "",
      "**流程：**",
      "1. x",
      "",
      "**預期：** y",
      "",
      "**結果：** 暫時跳過",
      "",
      "**說明：**",
      "（無）",
      "",
      "## T5 五 <!-- anc:t=V5 -->",
      "",
      "**流程：**",
      "1. x",
      "",
      "**預期：** y",
      "",
      "**結果：** 未測",
      "",
      "**說明：**",
      "（無）",
      "",
      "## T6 六 <!-- anc:t=V6 -->",
      "",
      "**流程：**",
      "1. x",
      "",
      "**預期：** y",
      "",
      "**結果：** pass",
      "",
      "**說明：**",
      "（無）",
      "",
      "## T7 七 <!-- anc:t=V7 -->",
      "",
      "**流程：**",
      "1. x",
      "",
      "**預期：** y",
      "",
      "**結果：** fail",
      "",
      "**說明：**",
      "原因",
      "",
      "## T8 八 <!-- anc:t=V8 -->",
      "",
      "**流程：**",
      "1. x",
      "",
      "**預期：** y",
      "",
      "**結果：** wont",
      "",
      "**說明：**",
      "原因",
      "",
      "## T9 九 <!-- anc:t=V9 -->",
      "",
      "**流程：**",
      "1. x",
      "",
      "**預期：** y",
      "",
      "**結果：** later",
      "",
      "**說明：**",
      "（無）",
      "",
      "## T10 十 <!-- anc:t=V10 -->",
      "",
      "**流程：**",
      "1. x",
      "",
      "**預期：** y",
      "",
      "**結果：** pending",
      "",
      "**說明：**",
      "（無）",
      "",
      "## T11 十一 <!-- anc:t=V11 -->",
      "",
      "**流程：**",
      "1. x",
      "",
      "**預期：** y",
      "",
      "**結果：** 火龍果",
      "",
      "**說明：**",
      "（無）",
      "",
    ].join("\n");

    expect(parseUatReport(text).items.map((item) => item.verdict)).toEqual([
      "pass",
      "fail",
      "wont",
      "later",
      "pending",
      "pass",
      "fail",
      "wont",
      "later",
      "pending",
      "pending",
    ]);
  });

  test("失敗與不測必填說明；通過與暫時跳過可留空", () => {
    const text = baseReport();

    expect(setVerdict(text, "AAAA1111", "fail", "   ")).toMatchObject({ ok: false });
    expect(setVerdict(text, "AAAA1111", "wont", "\n\t")).toMatchObject({ ok: false });
    expect(setVerdict(text, "AAAA1111", "pass", "")).toMatchObject({ ok: true });
    expect(setVerdict(text, "AAAA1111", "later", "   ")).toMatchObject({ ok: true });
  });

  test("只改 T2 的結果／說明與報告 header —— 其餘一字不改", () => {
    const before = baseReport();
    const out = setVerdict(before, "BBBB2222", "fail", "因為 API timeout", {
      now: "2026-08-14 12:45:00 +08:00",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const a = before.split("\n");
    const b = out.text.split("\n");
    expect(b.length).toBe(a.length);

    const statusAt = locateLine(a, (line) => line.startsWith("**狀態：**"));
    const updatedAt = locateLine(a, (line) => line.startsWith("**最後更新：**"));
    const section = locateSection(a, "BBBB2222");
    const resultAt = locateLine(
      a,
      (line) => line.trim() === "**結果：** 未測",
      section,
    );
    const noteLabelAt = locateLine(
      a,
      (line) => line.trim() === "**說明：**",
      section,
    );
    const noteAt = noteLabelAt + 1;

    const diff = a.map((line, i) => (line === b[i] ? null : i)).filter((i) => i !== null);
    const allowed = [updatedAt, resultAt, noteAt];
    if (a[statusAt] !== b[statusAt]) allowed.push(statusAt);
    expect(diff).toEqual(allowed.sort((x, y) => x - y));
    expect(b[resultAt]).toBe("**結果：** 失敗");
    expect(b[noteAt]).toBe("因為 API timeout");
    expect(b[statusAt]).toBe("**狀態：** 進行中");
    expect(b[updatedAt]).toBe("**最後更新：** 2026-08-14 12:45:00 +08:00");
  });

  test("同一題連改三次 —— 中間題不會長出多餘空行，第二次之後文字穩定", () => {
    const first = setVerdict(baseReport(), "BBBB2222", "fail", "第一次失敗", {
      now: "2026-08-14 12:50:00 +08:00",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = setVerdict(first.text, "BBBB2222", "later", "", {
      now: "2026-08-14 12:51:00 +08:00",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const third = setVerdict(second.text, "BBBB2222", "later", "", {
      now: "2026-08-14 12:51:00 +08:00",
    });
    expect(third.ok).toBe(true);
    if (!third.ok) return;

    expect(second.text).toBe(third.text);
    expect(third.text.includes("\n\n\n")).toBe(false);
    expect(parseUatReport(third.text).items[1]).toMatchObject({
      verdict: "later",
      note: "",
    });
  });

  test("同一題連改三次 —— 最後一題也不能掉結構，第二次之後文字穩定", () => {
    const first = setVerdict(baseReport(), "CCCC3333", "fail", "最後一題失敗", {
      now: "2026-08-14 12:52:00 +08:00",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = setVerdict(first.text, "CCCC3333", "pass", "", {
      now: "2026-08-14 12:53:00 +08:00",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const third = setVerdict(second.text, "CCCC3333", "pass", "", {
      now: "2026-08-14 12:53:00 +08:00",
    });
    expect(third.ok).toBe(true);
    if (!third.ok) return;

    expect(second.text).toBe(third.text);
    expect(third.text.endsWith("\n")).toBe(true);
    expect(third.text.includes("\n\n\n")).toBe(false);
    expect(parseUatReport(third.text).items[2]).toMatchObject({
      verdict: "pass",
      note: "",
    });
  });

  test("全部非 pending 才算已完成；只要翻回一題 pending 就回到進行中", () => {
    const step1 = setVerdict(baseReport(), "AAAA1111", "pass", "", {
      now: "2026-08-14 13:00:00 +08:00",
    });
    expect(step1.ok).toBe(true);
    if (!step1.ok) return;
    const step2 = setVerdict(step1.text, "BBBB2222", "fail", "因為 timeout", {
      now: "2026-08-14 13:01:00 +08:00",
    });
    expect(step2.ok).toBe(true);
    if (!step2.ok) return;
    const step3 = setVerdict(step2.text, "CCCC3333", "later", "", {
      now: "2026-08-14 13:02:00 +08:00",
    });
    expect(step3.ok).toBe(true);
    if (!step3.ok) return;

    expect(parseUatReport(step3.text).status).toBe("已完成");
    expect(step3.text).toContain("**狀態：** 已完成");

    const reverted = setVerdict(step3.text, "BBBB2222", "pending", "", {
      now: "2026-08-14 13:03:00 +08:00",
    });
    expect(reverted.ok).toBe(true);
    if (!reverted.ok) return;

    expect(parseUatReport(reverted.text).status).toBe("進行中");
    expect(reverted.text).toContain("**狀態：** 進行中");
  });

  test("沒有 anc:t= 的題要算進 unanchored；找不到 id 時要明確失敗，不准亂改別題", () => {
    const text = handWrittenReport();
    const parsed = parseUatReport(text);
    expect(parsed.unanchored).toBe(1);

    expect(setVerdict(text, "NO_SUCH_ID", "pass", "")).toMatchObject({ ok: false });
  });

  test("validateUatSpec 一次吐完整份錯誤清單 —— 不要擠牙膏式一次報一個", () => {
    const r = validateUatSpec({
      title: "   ",
      items: [
        {
          title: "",
          steps: ["第一步", "   "],
          expected: "",
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;

    expect(r.errors).toEqual(
      expect.arrayContaining([
        "title：必填，一句話的報告標題",
        "items[0].title：必填",
        "items[0].steps：至少一步，且每一步都要有內容 —— 流程要詳細到照著做就能重現",
        "items[0].expected：必填 —— 預期效果要具體到可以判定通過或失敗",
      ]),
    );
    expect(r.errors.length).toBeGreaterThan(2);
  });

  test("validateUatSpec 連缺 title 與 items 都要一起回報，不准卡在第一個錯", () => {
    const r = validateUatSpec({ title: "  ", items: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;

    expect(r.errors).toEqual([
      "title：必填，一句話的報告標題",
      "items：至少要有一題",
    ]);
  });

  test("isUatText 只認真正的 UAT H1；拿真實 plan 檔來看也不能誤判", () => {
    expect(isUatText(baseReport())).toBe(true);

    const plan = readFileSync(
      new URL("../plans/2026-08-06_manual-test-tasklist.md", import.meta.url),
      "utf8",
    );
    expect(isUatText(plan)).toBe(false);
  });
});

describe("Cato 審計回歸（F2/F3/F5）", () => {
  const spec = {
    title: "審計回歸",
    items: [
      { title: "唯一一題", steps: ["做一件事"], expected: "看到結果" },
    ],
  };

  test("F2：說明裡長得像 **結果：** 的行是內容，寫回不會誤傷、重寫不留殘渣", () => {
    const text = serializeUatReport(spec, { now: "2026-08-14 21:00", mint: mintFrom(["AAAA2222"]) });
    const fakeNote = "第一行\n**結果：** API 回 500\n第二行";
    const r1 = setVerdict(text, "AAAA2222", "fail", fakeNote);
    if (!r1.ok) throw new Error(r1.reason);

    const parsed = parseUatReport(r1.text);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]!.verdict).toBe("fail");
    expect(parsed.items[0]!.note).toBe(fakeNote);

    // 再改一次：假標籤行要跟著舊說明整塊被換掉，不能殘留
    const r2 = setVerdict(r1.text, "AAAA2222", "pass", "修好了");
    if (!r2.ok) throw new Error(r2.reason);
    expect(r2.text.includes("API 回 500")).toBe(false);
    const reparsed = parseUatReport(r2.text);
    expect(reparsed.items[0]!.verdict).toBe("pass");
    expect(reparsed.items[0]!.note).toBe("修好了");
  });

  test("F3：手改出來的「失敗但沒說明」不算已完成", () => {
    const text = serializeUatReport(spec, { now: "2026-08-14 21:00", mint: mintFrom(["BBBB3333"]) });
    const handEdited = text.replace("**結果：** 未測", "**結果：** 失敗");
    const parsed = parseUatReport(handEdited);
    expect(parsed.items[0]!.verdict).toBe("fail");
    expect(parsed.status).toBe("進行中");

    const fixed = setVerdict(handEdited, "BBBB3333", "fail", "有寫原因");
    if (!fixed.ok) throw new Error(fixed.reason);
    expect(parseUatReport(fixed.text).status).toBe("已完成");
  });

  test("F5：圍欄程式碼裡的 ## 與標籤行不拆題，寫回照常命中", () => {
    const text = serializeUatReport(spec, { now: "2026-08-14 21:00", mint: mintFrom(["CCCC4444"]) });
    const fencedNote = "看 log：\n```\n## 這不是新題\n**結果：** 假的\n```\n完";
    const r1 = setVerdict(text, "CCCC4444", "fail", fencedNote);
    if (!r1.ok) throw new Error(r1.reason);

    const parsed = parseUatReport(r1.text);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]!.note).toBe(fencedNote);

    const r2 = setVerdict(r1.text, "CCCC4444", "later", "");
    if (!r2.ok) throw new Error(r2.reason);
    expect(parseUatReport(r2.text).items[0]!.verdict).toBe("later");
  });
});
