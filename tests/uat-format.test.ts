/**
 * `uat-format.ts` 的純函式測試。
 *
 * 三塊值得釘住的東西：
 *
 * 1. **快照檔名規則** —— 它是 Rust 端 `valid_history_name` 的鏡像。兩份實作
 *    漂開的症狀是「清單列得出來但點不開」，而那看起來像後端壞了。
 * 2. **變更紀錄解析** —— 壞行必須跳過而不是讓整份紀錄消失。
 * 3. **`stripFence`** —— 模型會無視「不要用圍欄」。剝過頭會吃掉規格文件內部
 *    那個示範檔案結構的程式碼區塊，剝不夠則會讓圍欄一輪一輪疊上去。
 */
import { describe, expect, test } from "bun:test";
import {
  aiAdjustUser,
  aiNote,
  formatLogTime,
  HISTORY_NAME_RE,
  isHistoryName,
  parseFormatLog,
  snapshotLabel,
  stripFence,
  UAT_FORMAT_DEFAULT,
} from "../src/lib/uat-format";

describe("isHistoryName — Rust valid_history_name 的鏡像", () => {
  test("收下兩種合法形狀", () => {
    expect(isHistoryName("20260814-120000.md")).toBe(true);
    expect(isHistoryName("20260814-120000-2.md")).toBe(true);
    expect(isHistoryName("20260814-120000-50.md")).toBe(true);
  });

  test("擋掉路徑穿越 —— 這是這條規則存在的理由", () => {
    expect(isHistoryName("../uat-format.md")).toBe(false);
    expect(isHistoryName("../../.ssh/id_rsa.md")).toBe(false);
    expect(isHistoryName("/etc/passwd.md")).toBe(false);
    expect(isHistoryName("20260814-120000/../x.md")).toBe(false);
  });

  test("位數不對就不收", () => {
    expect(isHistoryName("2026814-120000.md")).toBe(false);
    expect(isHistoryName("202608141-120000.md")).toBe(false);
    expect(isHistoryName("20260814-12000.md")).toBe(false);
    expect(isHistoryName("20260814-1200000.md")).toBe(false);
  });

  test("結構變形就不收", () => {
    expect(isHistoryName("20260814.md")).toBe(false);
    expect(isHistoryName("20260814-120000-2-3.md")).toBe(false);
    expect(isHistoryName("20260814-120000-.md")).toBe(false);
    expect(isHistoryName("20260814-120000-a.md")).toBe(false);
    expect(isHistoryName("")).toBe(false);
  });

  test("副檔名必須是小寫 .md", () => {
    expect(isHistoryName("20260814-120000")).toBe(false);
    expect(isHistoryName("20260814-120000.txt")).toBe(false);
    expect(isHistoryName("20260814-120000.MD")).toBe(false);
  });

  test("正規式有錨定 —— 換行接一個合法名字騙不過去", () => {
    // 沒有 ^$ 的正規式會在這裡回 true，而那正是任意檔名的入口
    expect(HISTORY_NAME_RE.test("bad\n20260814-120000.md")).toBe(false);
    expect(HISTORY_NAME_RE.test("20260814-120000.md\nbad")).toBe(false);
  });
});

describe("parseFormatLog", () => {
  test("最新的排在最前面", () => {
    const text = [
      `{"ts":"2026-08-14T01:00:00Z","source":"manual","note":"第一次"}`,
      `{"ts":"2026-08-14T02:00:00Z","source":"ai","note":"第二次"}`,
    ].join("\n");
    const out = parseFormatLog(text);
    expect(out).toHaveLength(2);
    expect(out[0]!.note).toBe("第二次");
    expect(out[0]!.source).toBe("ai");
    expect(out[1]!.note).toBe("第一次");
  });

  test("壞行跳過，好行留著 —— 一行壞掉不該讓整份紀錄消失", () => {
    const text = [
      `{"ts":"2026-08-14T01:00:00Z","source":"manual","note":"好的"}`,
      `{"ts":"2026-08-14T01:30:00Z","sou`, // 被砍在半途的一行
      `不是 JSON`,
      ``,
      `{"ts":"2026-08-14T02:00:00Z","source":"ai","note":"也是好的"}`,
    ].join("\n");
    expect(parseFormatLog(text).map((e) => e.note)).toEqual(["也是好的", "好的"]);
  });

  test("認不得的 source 一律退回 manual —— 往不宣稱的方向退", () => {
    const out = parseFormatLog(`{"ts":"2026-08-14T01:00:00Z","source":"robot","note":"x"}`);
    expect(out[0]!.source).toBe("manual");
  });

  test("缺欄位的行：沒有 ts 就丟掉，沒有 note 就當空字串", () => {
    const text = [
      `{"source":"ai","note":"沒有時間戳"}`,
      `{"ts":"2026-08-14T01:00:00Z","source":"manual"}`,
    ].join("\n");
    const out = parseFormatLog(text);
    expect(out).toHaveLength(1);
    expect(out[0]!.note).toBe("");
  });

  test("空輸入回空陣列，不丟例外", () => {
    expect(parseFormatLog("")).toEqual([]);
    expect(parseFormatLog("\n\n  \n")).toEqual([]);
  });

  test("note 裡的換行（jsonl 的 \\n 轉義）讀得回來，且不會被切成兩筆", () => {
    const out = parseFormatLog(
      JSON.stringify({ ts: "2026-08-14T01:00:00Z", source: "ai", note: "第一行\n第二行" }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.note).toBe("第一行\n第二行");
  });
});

describe("stripFence", () => {
  test("整份被圍欄包住時剝掉", () => {
    expect(stripFence("```markdown\n# 標題\n內文\n```")).toBe("# 標題\n內文");
    expect(stripFence("```\n# 標題\n```")).toBe("# 標題");
    expect(stripFence("~~~md\n# 標題\n~~~")).toBe("# 標題");
  });

  test("沒有圍欄就原樣回傳（只 trim）", () => {
    expect(stripFence("  # 標題\n內文  ")).toBe("# 標題\n內文");
  });

  test("內文自己的程式碼區塊要留著 —— 預設規格裡就有一個", () => {
    const doc = "# 標題\n\n```markdown\n# UAT: x\n```\n\n結尾";
    expect(stripFence(doc)).toBe(doc);
  });

  test("只有開頭圍欄、沒有收尾時不剝 —— 那多半是被截斷的回應", () => {
    const half = "```markdown\n# 標題\n內文還沒完";
    expect(stripFence(half)).toBe(half);
  });

  test("開頭是圍欄、內文也有圍欄時，只剝最外層", () => {
    const wrapped = "```markdown\n# 標題\n\n```md\n內層\n```\n\n尾\n```";
    expect(stripFence(wrapped)).toBe("# 標題\n\n```md\n內層\n```\n\n尾");
  });
});

describe("aiNote", () => {
  test("空白摺疊成單一空格", () => {
    expect(aiNote("  改成   20 題\n上限  ")).toBe("改成 20 題 上限");
  });

  test("超過 120 字截斷並加省略號", () => {
    const long = "改".repeat(200);
    const out = aiNote(long);
    expect(out).toHaveLength(121); // 120 個字 + 一個省略號
    expect(out.endsWith("…")).toBe(true);
  });

  test("剛好 120 字不截斷", () => {
    const exact = "改".repeat(120);
    expect(aiNote(exact)).toBe(exact);
  });
});

describe("snapshotLabel / formatLogTime", () => {
  test("拿不到 mtime 時退回顯示檔名，不顯示 1970 年", () => {
    expect(snapshotLabel("20260814-120000.md", 0)).toBe("20260814-120000.md");
  });

  test("有 mtime 就轉成本地時間", () => {
    const ms = new Date(2026, 7, 14, 12, 30, 5).getTime();
    expect(snapshotLabel("20260814-120000.md", ms)).toBe("2026-08-14 12:30:05");
  });

  test("認不得的 ISO 字串原樣回傳，不要編一個時間出來", () => {
    expect(formatLogTime("不是時間")).toBe("不是時間");
    expect(formatLogTime("")).toBe("");
  });
});

describe("aiAdjustUser", () => {
  test("當前內容與指示都在，指示在後面壓軸", () => {
    const out = aiAdjustUser("目前的規格", "把題數上限改成 20");
    expect(out).toContain("目前的規格");
    expect(out).toContain("把題數上限改成 20");
    expect(out.indexOf("目前的規格")).toBeLessThan(out.indexOf("把題數上限改成 20"));
  });
});

describe("UAT_FORMAT_DEFAULT", () => {
  test("描述的檔案結構與 uat-parser 的方言一致", () => {
    // 這五個標籤是 uat-parser 的 LABEL_RE 認得的全部。預設規格若描述了
    // 別的標籤名，agent 會照著寫出解析不出題目的報告 —— 而症狀是題目
    // 全部消失，不是錯誤訊息。
    for (const label of ["**流程：**", "**預期：**", "**結果：**", "**說明：**", "**附件：**"]) {
      expect(UAT_FORMAT_DEFAULT).toContain(label);
    }
    expect(UAT_FORMAT_DEFAULT).toContain("## 補充說明");
    expect(UAT_FORMAT_DEFAULT).toContain("# UAT:");
    expect(UAT_FORMAT_DEFAULT).toContain("anc:t=");
  });

  test("五個結果詞一個都不能少", () => {
    for (const v of ["未測", "通過", "失敗", "不測", "暫時跳過"]) {
      expect(UAT_FORMAT_DEFAULT).toContain(v);
    }
  });

  test("必填說明的規則有寫出來", () => {
    expect(UAT_FORMAT_DEFAULT).toContain("必須填說明");
  });

  test("是 markdown 而不是空的", () => {
    expect(UAT_FORMAT_DEFAULT.startsWith("# ")).toBe(true);
    expect(UAT_FORMAT_DEFAULT.length).toBeGreaterThan(500);
  });
});
