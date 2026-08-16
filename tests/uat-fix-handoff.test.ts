import { describe, expect, test } from "bun:test";
import { buildHandoff } from "../src/lib/agent-handoff";
import type { UatReport } from "../src/lib/uat-parser";
import { uatFixTask, uatProjectRoot } from "../src/lib/uat-fix-handoff";

function report(overrides: Partial<UatReport> = {}): UatReport {
  return {
    title: "Checkout UAT",
    created: "2026-08-14 10:00 +08:00",
    updated: "2026-08-14 11:00 +08:00",
    status: "進行中",
    path: "/repo/plans/uat-checkout.md",
    unanchored: 0,
    extras: [],
    items: [],
    ...overrides,
  };
}

describe("uatProjectRoot", () => {
  test("正常路徑：取回 plans 前一層作為專案根目錄", () => {
    expect(uatProjectRoot("/a/b/plans/uat-x.md")).toBe("/a/b");
  });

  test("沒有 /plans/ 路徑段：回 null，避免把 agent 帶去錯目錄", () => {
    expect(uatProjectRoot("/a/b/docs/uat-x.md")).toBeNull();
  });

  test("結尾斜線：先正規化再判斷，/plans/ 目錄本身也能回到專案根", () => {
    expect(uatProjectRoot("/a/b/plans/")).toBe("/a/b");
  });

  test("深層路徑：保留完整深度，不要多吃父層", () => {
    expect(uatProjectRoot("/a/b/c/d/plans/uat-x.md")).toBe("/a/b/c/d");
  });

  test("段落只是含有 plans：不算真正的 /plans/ 路徑段", () => {
    expect(uatProjectRoot("/a/myplans/uat-x.md")).toBeNull();
    expect(uatProjectRoot("/a/plansX/u.md")).toBeNull();
  });

  test("多個 plans 段：取最後一個，避免把 root 拉得過大", () => {
    expect(uatProjectRoot("/a/plans/b/plans/uat.md")).toBe("/a/plans/b");
  });

  test("root-level /plans：回 null，不要產生空 projectRoot", () => {
    expect(uatProjectRoot("/plans/uat.md")).toBeNull();
  });

  test("空字串或空白：回 null", () => {
    expect(uatProjectRoot("")).toBeNull();
    expect(uatProjectRoot("   ")).toBeNull();
  });
});

describe("uatFixTask", () => {
  test("失敗 + 不測 + 未測混合：失敗題保留原說明，不測題標成不用修，未測題保留數量", () => {
    const r = report({
      items: [
        {
          id: "A1B2C3D4",
          title: "T1 送出後 spinner 不會停",
          steps: ["送出表單"],
          expected: "成功送出後 spinner 消失",
          verdict: "fail",
          note: "按下送出後 spinner 一直轉，畫面不回來。",
        },
        {
          id: "B2C3D4E5",
          title: "T2 二次確認視窗文案先不驗",
          steps: ["開啟確認視窗"],
          expected: "顯示正確文案",
          verdict: "wont",
          note: "這輪只驗功能，不驗文案。",
        },
        {
          id: "C3D4E5F6",
          title: "T3 匯出 PDF",
          steps: ["按匯出"],
          expected: "下載成功",
          verdict: "pending",
          note: "",
        },
        {
          id: "D4E5F6G7",
          title: "T4 行動版排版",
          steps: ["切換手機寬度"],
          expected: "卡片不重疊",
          verdict: "later",
          note: "",
        },
      ],
    });

    const out = uatFixTask(r);
    expect(out).toContain("anc:t=A1B2C3D4");
    expect(out).toContain("按下送出後 spinner 一直轉，畫面不回來。");
    expect(out).toContain("這輪只驗功能，不驗文案。");
    expect(out).toContain("FYI only，不用修");
    expect(out).toContain("使用者尚未測完 1 題");
    expect(out).toContain("暫時跳過題");
  });

  test("零失敗：改成無需修復的收尾訊息，不產生 fix 工單結構", () => {
    const r = report({
      status: "已完成",
      items: [
        {
          id: "A1B2C3D4",
          title: "T1 登入成功",
          steps: ["登入"],
          expected: "進入首頁",
          verdict: "pass",
          note: "",
        },
        {
          id: "B2C3D4E5",
          title: "T2 舊瀏覽器支援",
          steps: ["IE 開啟"],
          expected: "畫面正常",
          verdict: "wont",
          note: "產品決定不驗這個平台。",
        },
        {
          id: "C3D4E5F6",
          title: "T3 列印",
          steps: ["列印"],
          expected: "完成列印",
          verdict: "later",
          note: "",
        },
      ],
    });

    const out = uatFixTask(r);
    expect(out).toContain("全數通過/跳過，無需修復");
    expect(out).not.toContain("## 修復原則");
    expect(out).not.toContain("## 失敗題 1");
    expect(out).not.toContain('Skill("Uat")');
  });

  test("無錨點題：絕不輸出空的或假的治理錨點", () => {
    const r = report({
      unanchored: 2,
      items: [
        {
          id: "BAD!",
          title: "T1 送出後卡死",
          steps: ["送出"],
          expected: "成功結束",
          verdict: "fail",
          note: "只能強制重整。",
        },
        {
          title: "T2 付款跳轉失敗",
          steps: ["付款"],
          expected: "成功回站",
          verdict: "fail",
          note: "回跳時 404。",
        },
        {
          id: "A1B2C3D4",
          title: "T3 文案檢查",
          steps: ["看畫面"],
          expected: "文案正確",
          verdict: "wont",
          note: "這輪不驗文案。",
        },
      ],
    });

    const out = uatFixTask(r);
    expect(/anc:t=(?![0-9A-HJKMNP-TV-Z]{4,32}\b)/.test(out)).toBe(false);
    expect(/anc:t=\s*(?:$|\n)/m.test(out)).toBe(false);
    expect(out).toContain("無可用錨點");
    expect(out).toContain("不要自己補治理錨點");
  });

  test("r.path 未提供：文字仍可用，且絕不把 undefined 印出去", () => {
    const r = report({
      path: undefined,
      items: [
        {
          id: "A1B2C3D4",
          title: "T1 API timeout",
          steps: ["送出"],
          expected: "成功",
          verdict: "fail",
          note: "timeout",
        },
      ],
    });

    const out = uatFixTask(r);
    expect(out).toContain("標題「Checkout UAT」");
    expect(out).not.toContain("undefined");
  });

  test("和 buildHandoff 組合後，shell quoting 可完整往返原字串", () => {
    const root = "/tmp/uat repo";
    const r = report({
      path: `${root}/plans/uat-fix.md`,
      items: [
        {
          id: "A1B2C3D4",
          title: "T1 特殊字元",
          steps: ["送出"],
          expected: "成功",
          verdict: "fail",
          note: [
            "it's broken",
            "can't submit",
            "「」『』\"\" ''",
            "`inline` and ```fence```",
            "$(echo nope)",
            "- markdown item",
            "",
            "> blockquote",
          ].join("\n"),
        },
      ],
    });

    const task = uatFixTask(r);
    const h = buildHandoff({ projectRoot: root, task, family: "claude" });
    const prefix = "cd '/tmp/uat repo' && claude -p ";
    expect(h.blocked).toBeNull();
    expect(h.command.startsWith(prefix)).toBe(true);

    const quotedTask = h.command.slice(prefix.length);
    const printed = Bun.spawnSync({
      cmd: ["/bin/sh", "-c", `printf %s ${quotedTask}`],
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(printed.exitCode).toBe(0);
    expect(Buffer.from(printed.stderr).toString("utf8")).toBe("");
    expect(Buffer.from(printed.stdout)).toEqual(Buffer.from(task, "utf8"));
  });

  test("失敗題附件與報告末補充都進交接，並帶絕對路徑", () => {
    const r = report({
      path: "/repo/plans/uat-checkout.md",
      items: [
        {
          id: "A1B2C3D4",
          title: "T1 過濾列",
          steps: ["看上方"],
          expected: "在紀錄上方",
          verdict: "fail",
          note: "跑到下方",
          evidence: [
            {
              name: "T1-01.png",
              rel: "uat-assets/uat-checkout/T1-01.png",
              caption: "紅框是實際位置",
            },
          ],
        },
      ],
      extras: [
        {
          n: 1,
          text: "側欄太窄",
          evidence: [
            {
              name: "S1-01.png",
              rel: "uat-assets/uat-checkout/S1-01.png",
              caption: "iPhone SE",
            },
          ],
        },
      ],
    });
    const out = uatFixTask(r);
    expect(out).toContain("/repo/plans/uat-assets/uat-checkout/T1-01.png（紅框是實際位置）");
    expect(out).toContain("## 補充說明（題目以外）");
    expect(out).toContain("### 補充 1");
    expect(out).toContain("側欄太窄");
    expect(out).toContain("/repo/plans/uat-assets/uat-checkout/S1-01.png（iPhone SE）");
    expect(out).toContain("不要當成帶錨點的失敗題");
  });
});
