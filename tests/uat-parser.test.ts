import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import {
  isUatText,
  parseUatReport,
  serializeUatReport,
  setReportClosed,
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

  test("完成標記讓還有未測題的報告算已完成，撤回後回到進行中", () => {
    const marked = setReportClosed(baseReport(), true, { now: "2026-08-18 21:30" });
    expect(marked.ok).toBe(true);
    if (!marked.ok) return;
    const parsed = parseUatReport(marked.text);
    expect(parsed.closedAt).toBe("2026-08-18 21:30");
    expect(parsed.status).toBe("已完成");
    expect(marked.text).toContain("**完成標記：** 2026-08-18 21:30");
    expect(marked.text).toContain("**狀態：** 已完成");

    const opened = setReportClosed(marked.text, false, { now: "2026-08-18 21:31" });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const after = parseUatReport(opened.text);
    expect(after.closedAt).toBe("");
    expect(after.status).toBe("進行中");
    expect(opened.text).not.toContain("**完成標記：**");
    expect(opened.text).toContain("**狀態：** 進行中");
  });

  test("撤回完成標記時，全題已測的報告仍是已完成", () => {
    const step1 = setVerdict(baseReport(), "AAAA1111", "pass", "", { now: "2026-08-18 21:00" });
    if (!step1.ok) return;
    const step2 = setVerdict(step1.text, "BBBB2222", "later", "", { now: "2026-08-18 21:01" });
    if (!step2.ok) return;
    const step3 = setVerdict(step2.text, "CCCC3333", "later", "", { now: "2026-08-18 21:02" });
    if (!step3.ok) return;
    const marked = setReportClosed(step3.text, true, { now: "2026-08-18 21:03" });
    if (!marked.ok) return;
    const opened = setReportClosed(marked.text, false, { now: "2026-08-18 21:04" });
    if (!opened.ok) return;
    expect(parseUatReport(opened.text).status).toBe("已完成");
    expect(opened.text).not.toContain("**完成標記：**");
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

describe("UAT 檔頭脈絡／context 契約", () => {
  const instructionLine =
    "> 在 Anchorline 的 UAT使用者測試 開這一份逐題勾選。「失敗」與「不測」必須填說明。";

  test("serialize 再 parse 時，context 的空白行與 inline markdown 都要原樣留在 preamble", () => {
    const text = serializeUatReport(
      {
        title: "context round-trip",
        context: "目的：驗證\n\n**環境：** macOS\n保留 `code` span",
        items: [
          {
            title: "唯一一題",
            steps: ["照流程做"],
            expected: "看到正確結果",
          },
        ],
      },
      { now: "2026-08-14 22:10", mint: mintFrom(["AAAA1111"]) },
    );

    const parsed = parseUatReport(text);
    expect(parsed.preamble).toBe(
      [
        "> 目的：驗證",
        ">",
        "> **環境：** macOS",
        "> 保留 `code` span",
        "",
        instructionLine,
      ].join("\n"),
    );
  });

  test("沒給 context 或只給空白時，preamble 只剩標準指示且序列化位元組完全相同", () => {
    const spec = {
      title: "no context",
      items: [
        {
          title: "唯一一題",
          steps: ["照流程做"],
          expected: "看到正確結果",
        },
      ],
    };

    const omitted = serializeUatReport(spec, {
      now: "2026-08-14 22:11",
      mint: mintFrom(["BBBB2222"]),
    });
    const empty = serializeUatReport({ ...spec, context: "" }, {
      now: "2026-08-14 22:11",
      mint: mintFrom(["BBBB2222"]),
    });
    const blank = serializeUatReport({ ...spec, context: "   \n\t " }, {
      now: "2026-08-14 22:11",
      mint: mintFrom(["BBBB2222"]),
    });

    expect(empty).toBe(omitted);
    expect(blank).toBe(omitted);
    expect(parseUatReport(omitted).preamble).toBe(instructionLine);
    expect(parseUatReport(empty).preamble).toBe(instructionLine);
    expect(parseUatReport(blank).preamble).toBe(instructionLine);
  });

  test("setVerdict 只准改狀態／最後更新，rich context 檔頭其餘每一行都必須位元組不變", () => {
    const before = serializeUatReport(
      {
        title: "header stable",
        context: "目的：回歸 rich header\n\n**環境：** sandbox\n保留 `code`",
        items: [
          {
            title: "唯一一題",
            steps: ["按下按鈕"],
            expected: "題目狀態完成",
          },
        ],
      },
      { now: "2026-08-14 22:12", mint: mintFrom(["CCCC3333"]) },
    );

    const after = setVerdict(before, "CCCC3333", "pass", "", {
      now: "2026-08-14 22:13",
    });
    expect(after.ok).toBe(true);
    if (!after.ok) return;

    const a = before.split("\n");
    const b = after.text.split("\n");
    const firstSection = locateLine(a, (line) => line.startsWith("## "));
    const statusAt = locateLine(a, (line) => line.startsWith("**狀態：**"));
    const updatedAt = locateLine(a, (line) => line.startsWith("**最後更新：**"));

    expect(b.findIndex((line) => line.startsWith("## "))).toBe(firstSection);

    const diff = a
      .slice(0, firstSection)
      .map((line, i) => (line === b[i] ? null : i))
      .filter((i) => i !== null);
    expect(diff).toEqual([updatedAt, statusAt]);
    expect(b[statusAt]).toBe("**狀態：** 已完成");
    expect(b[updatedAt]).toBe("**最後更新：** 2026-08-14 22:13");
  });

  test("手寫檔頭把 meta 行穿插在 blockquote 前後也照樣吃對；status 不得漏進 preamble", () => {
    // 這裡刻意把 H1 前噪音視為 preamble，明確釘住目前「原樣保存」而不是丟棄的選擇。
    const text = [
      "這行在 H1 前，現在合約是保留它",
      "# UAT: 手寫 context",
      "",
      "**建立時間：** 2026-08-14 09:00",
      "> 第一段 blockquote",
      "**最後更新：** 2026-08-14 09:30",
      "> 第二段 blockquote",
      "**狀態：** 已完成",
      "",
      "一般自由文字",
      "",
      "## T1 唯一一題 <!-- anc:t=DDDD4444 -->",
      "",
      "**流程：**",
      "1. 手寫也能過",
      "",
      "**預期：** parser 不亂掉",
      "",
      "**結果：** 未測",
      "",
      "**說明：**",
      "（無）",
      "",
    ].join("\n");

    const parsed = parseUatReport(text);
    expect(parsed.created).toBe("2026-08-14 09:00");
    expect(parsed.updated).toBe("2026-08-14 09:30");
    expect(parsed.status).toBe("進行中");
    expect(parsed.preamble).toBe(
      [
        "這行在 H1 前，現在合約是保留它",
        "",
        "> 第一段 blockquote",
        "> 第二段 blockquote",
        "",
        "一般自由文字",
      ].join("\n"),
    );
  });

  test("檔頭裡的假結果行與 fenced ## 只算 preamble，不會污染題目或長出幽靈題", () => {
    const text = [
      "# UAT: preamble guard",
      "",
      "**建立時間：** 2026-08-14",
      "**最後更新：** 2026-08-14",
      "**狀態：** 進行中",
      "",
      "**結果：** 通過",
      "```md",
      "## 這不是新題",
      "**結果：** 失敗",
      "```",
      "",
      "## T1 唯一一題 <!-- anc:t=EEEE5555 -->",
      "",
      "**流程：**",
      "1. 照流程做",
      "",
      "**預期：** 題目仍只有一題",
      "",
      "**結果：** 未測",
      "",
      "**說明：**",
      "（無）",
      "",
    ].join("\n");

    const parsed = parseUatReport(text);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]!.verdict).toBe("pending");
    expect(parsed.preamble).toBe(
      [
        "**結果：** 通過",
        "```md",
        "## 這不是新題",
        "**結果：** 失敗",
        "```",
      ].join("\n"),
    );
  });

  test("題目說明內出現建立時間／最後更新／狀態樣式的行，setVerdict 後也必須位元組不丟失", () => {
    const before = serializeUatReport(
      {
        title: "note meta fidelity",
        context: "目的：驗證 note round-trip",
        items: [
          {
            title: "唯一一題",
            steps: ["貼上除錯紀錄"],
            expected: "說明全文原樣保留",
          },
        ],
      },
      { now: "2026-08-14 22:14", mint: mintFrom(["FFFF6666"]) },
    );
    const note = [
      "log 貼上來：",
      "**建立時間：** 1999-01-01",
      "**最後更新：** 1999-01-02",
      "**狀態：** 進行中",
      "完",
    ].join("\n");

    const after = setVerdict(before, "FFFF6666", "fail", note, {
      now: "2026-08-14 22:15",
    });
    expect(after.ok).toBe(true);
    if (!after.ok) return;

    const parsed = parseUatReport(after.text);
    expect(parsed.items[0]!.note).toBe(note);
  });

  test("題目說明內的假建立時間／最後更新不得回寫污染真正檔頭", () => {
    const before = serializeUatReport(
      {
        title: "header immunity",
        context: "目的：驗證 header 不被 note 汙染",
        items: [
          {
            title: "唯一一題",
            steps: ["貼上含 meta 字樣的失敗說明"],
            expected: "真正檔頭時間維持原值",
          },
        ],
      },
      { now: "2026-08-14 22:16", mint: mintFrom(["GGGG7777"]) },
    );
    const note = [
      "log 貼上來：",
      "**建立時間：** 1999-01-01",
      "**最後更新：** 1999-01-02",
      "**狀態：** 進行中",
      "完",
    ].join("\n");

    const after = setVerdict(before, "GGGG7777", "fail", note, {
      now: "2026-08-14 22:17",
    });
    expect(after.ok).toBe(true);
    if (!after.ok) return;

    const parsed = parseUatReport(after.text);
    expect(parsed.created).toBe("2026-08-14 22:16");
    expect(parsed.updated).toBe("2026-08-14 22:17");
  });

  test("validateUatSpec 的 context 只接受字串，合法內容要原樣留在回傳 spec", () => {
    const bad = validateUatSpec({
      title: "validate context",
      context: 123,
      items: [
        {
          title: "唯一一題",
          steps: ["照流程做"],
          expected: "看到正確結果",
        },
      ],
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors).toEqual([
      "context：選填，但給了就必須是字串（檔頭脈絡自由文字）",
    ]);

    const good = validateUatSpec({
      title: "validate context",
      context: "目的：驗證 context",
      items: [
        {
          title: "唯一一題",
          steps: ["照流程做"],
          expected: "看到正確結果",
        },
      ],
    });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.spec.context).toBe("目的：驗證 context");
  });
});

describe("重測輪次 supersede 標記（W2-3）", () => {
  const BASE = [
    "# UAT: 新輪",
    "",
    "**建立時間：** 2026-08-15 03:00",
    "**最後更新：** 2026-08-15 03:00",
    "**狀態：** 進行中",
    "",
  ];
  const ITEM = [
    "## T1 題 <!-- anc:t=AAAA1111 -->",
    "",
    "**流程：**",
    "1. 步",
    "",
    "**預期：**",
    "果",
    "",
    "**結果：** 未測",
    "",
    "**說明：**",
    "（無）",
  ];

  test("讀出 blockquote 形式的重測標記", () => {
    const text = [...BASE, "> 重測自：/w/plans/uat-舊.md", "", ...ITEM].join("\n");
    expect(parseUatReport(text).supersedes).toBe("/w/plans/uat-舊.md");
  });

  test("人手剝掉 > 記號也讀得出", () => {
    const text = [...BASE, "重測自: /w/plans/uat-舊.md", "", ...ITEM].join("\n");
    expect(parseUatReport(text).supersedes).toBe("/w/plans/uat-舊.md");
  });

  test("多行誤貼 → 聽第一行", () => {
    const text = [...BASE, "> 重測自：/a.md", "> 重測自：/b.md", "", ...ITEM].join("\n");
    expect(parseUatReport(text).supersedes).toBe("/a.md");
  });

  test("沒有標記 → 欄位缺席，不是空字串", () => {
    const text = [...BASE, ...ITEM].join("\n");
    expect(parseUatReport(text).supersedes).toBeUndefined();
  });

  test("圍欄程式碼裡的重測字樣是內容不是指令（Cato F5 規矩，Grok C4）", () => {
    const text = [
      ...BASE,
      "```",
      "> 重測自：/w/plans/uat-victim.md",
      "```",
      "",
      ...ITEM,
    ].join("\n");
    expect(parseUatReport(text).supersedes).toBeUndefined();
  });

  test("題目區段裡出現同字樣不算標記——只認檔頭", () => {
    const item = ITEM.map((l) => (l === "（無）" ? "重測自：/not-a-marker.md" : l));
    const text = [...BASE, ...item].join("\n");
    expect(parseUatReport(text).supersedes).toBeUndefined();
  });

  test("serializeUatReport 帶 supersedes → 寫出重測標記，且能 round-trip", () => {
    const md = serializeUatReport(
      {
        title: "重測輪",
        supersedes: "/w/plans/uat-舊.md",
        items: [{ title: "題", steps: ["步"], expected: "果" }],
      },
      { now: "2026-08-15 03:00" },
    );
    expect(md).toContain("> 重測自：/w/plans/uat-舊.md");
    const back = parseUatReport(md);
    expect(back.supersedes).toBe("/w/plans/uat-舊.md");
    // preamble 原樣保存的合約不變：標記仍留在 preamble 裡
    expect(back.preamble).toContain("重測自");
  });

  test("validateUatSpec：supersedes 給了空字串要擋", () => {
    const r = validateUatSpec({ title: "t", supersedes: "  ", items: [{ title: "a", steps: ["s"], expected: "e" }] });
    expect(r.ok).toBe(false);
  });
});
