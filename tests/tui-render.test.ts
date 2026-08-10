import { describe, expect, test } from "bun:test";
import { c, dw, pad, pal } from "../src/cli/ansi";
import {
  asStatusWord,
  parsePlanMeta,
  planProgress,
  STATUS_WORDS,
} from "../src/lib/plan-parser";

describe("dw — 顯示寬度", () => {
  // 舊規則是「碼點 > 0xFF 算 2」。下面這批全部落在 > 0xFF 但實際是 1 格，
  // 正是垂直分隔線在 31–34 欄之間飄的成因。
  test.each(["│", "─", "═", "▶", "•", "✔", "✗", "○", "⚠", "⏸", "◐", "█", "░", "·"])(
    "UI 字形 %s 佔 1 格",
    (ch) => {
      expect(dw(ch)).toBe(1);
    },
  );

  test("CJK 佔 2 格", () => {
    expect(dw("字級系統")).toBe(8);
  });

  test("East Asian Ambiguous 按 macOS 中文終端釘死為 2", () => {
    expect(dw("—")).toBe(2);
    expect(dw("…")).toBe(2);
  });

  test("組合附加符號佔 0 格", () => {
    expect(dw("é")).toBe(1);
  });

  test("忽略 ANSI 序列", () => {
    expect(dw(`${pal.accent}abc${c.reset}`)).toBe(3);
  });
});

describe("pad — 回傳值的 dw 必等於 width", () => {
  const samples = [
    "",
    "abc",
    "字級系統：盤點、收斂成階梯",
    "▶ 治理覆蓋率 — 未治理 task",
    `${pal.accent}▶${c.reset} ${pal.muted}混色標題 — 很長很長很長${c.reset} •`,
    "écombining",
    "…",
  ];
  // 寬字邊界（奇數寬切在全形字中間）是最容易少一格的地方，所以掃一段連續寬度。
  for (const s of samples) {
    for (const w of [1, 2, 3, 7, 12, 20, 34, 80]) {
      test(`dw(pad(${JSON.stringify(s.slice(0, 14))}, ${w})) === ${w}`, () => {
        expect(dw(pad(s, w))).toBe(w);
      });
    }
  }

  test("width <= 0 回空字串，不丟 RangeError", () => {
    expect(pad("字", 0)).toBe("");
    expect(pad("字", -5)).toBe("");
  });

  test("截斷不留下 ANSI 殘片，且關掉未閉合的樣式", () => {
    const out = pad(`${pal.accent}很長的一段中文標題文字${c.reset}`, 8);
    expect(dw(out)).toBe(8);
    expect(out.endsWith(c.reset)).toBe(true);
    // 裁到一半的控制碼會以 `[38;5;` 這種殘片印上畫面
    expect(out.replace(/\x1b\[[0-9;]*m/g, "")).not.toContain("[");
  });
});

describe("planProgress — 百分比與分子同源", () => {
  const md = `# T

**狀態：** 進行中

## Plan Steps
- [x] 一
- [x] 二
- ~~三~~
- [ ] 四
`;
  const meta = parsePlanMeta(md, "t.md");

  test("分子是 done + skipped，不是 done", () => {
    const p = planProgress(meta);
    expect(meta.done_steps).toBe(2);
    expect(meta.skipped_steps).toBe(1);
    expect(p.closed).toBe(3);
    expect(p.total).toBe(4);
  });

  test("pct 必然等於 closed/total —— 不可能出現 100% 配 2/4", () => {
    const p = planProgress(meta);
    expect(p.pct).toBe(Math.round((p.closed / p.total) * 100));
  });

  test("全部 skipped 也是 100%，且分子跟著到頂", () => {
    const p = planProgress(parsePlanMeta("# T\n\n## Plan Steps\n- ~~一~~\n- ~~二~~\n", "t.md"));
    expect(p).toEqual({ closed: 2, total: 2, pct: 100 });
  });

  // 三個呈現端（TUI / tracking 頁分桶 / tracking 頁卡片）都靠這個等價關係：
  // 進度條到頂 ⟺ 分桶算「已結束」。任一邊改用 done_steps 就會斷開，卡片上
  // 100% 的 plan 會永遠留在「進行中」桶。
  test("pct === 100 等價於 closed === total", () => {
    const cases = [
      "- [x] 一\n- ~~二~~\n", // 混合，到頂
      "- ~~一~~\n- ~~二~~\n", // 全放棄，到頂
      "- [x] 一\n- [ ] 二\n", // 沒到頂
      "- [ ] 一\n", // 全沒動
    ];
    for (const body of cases) {
      const p = planProgress(parsePlanMeta(`# T\n\n## Plan Steps\n${body}`, "t.md"));
      expect(p.pct === 100).toBe(p.closed === p.total);
    }
  });

  test("零步驟不除以零", () => {
    expect(planProgress(parsePlanMeta("# T\n", "t.md"))).toEqual({
      closed: 0,
      total: 0,
      pct: 0,
    });
  });
});

describe("狀態詞彙 — 封閉列舉，完全比對", () => {
  test("五個詞都認得", () => {
    // 空列舉會讓下面的 each 一個都不跑，斷言恆真——先擋住這條退路
    expect(STATUS_WORDS.length).toBe(5);
    for (const w of STATUS_WORDS) expect(asStatusWord(w)).toBe(w);
  });

  // 這批全部包含某個狀態詞當子字串。舊的 includes("完成") 會把「尚未完成」判成綠色 ✔，
  // 圖示跟文字說反話——這條測試就是那個 bug 的 falsifier。
  test.each(["尚未完成", "未完成", "沒有完成", "解除阻塞", "取消暫停", "不放棄", ""])(
    "%s 不是合法狀態詞",
    (s) => {
      expect(asStatusWord(s)).toBeNull();
    },
  );
});
