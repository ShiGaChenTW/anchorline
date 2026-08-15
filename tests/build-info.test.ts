/**
 * 建置識別碼的組裝。
 *
 * 起因是一次真實的假 bug：`/Applications/Anchorline.app` 與剛 build 出來的 bundle
 * 版本字串都是 `1.1.0`，忘記換裝與換裝成功症狀相同，於是有一輪驗證是對著舊版做的。
 *
 * 這裡只釘純函式那一半 —— 注入本身（vite `define`）不 mock，那要靠實際 build 的
 * 產物去驗，寫成單元測試只會測到 mock 自己。
 */
import { describe, expect, test } from "bun:test";
import {
  UNKNOWN_BUILD_FIELD,
  formatBuildStamp,
  formatBuildTime,
  formatCommit,
  normalizeInjected,
  type BuildInfo,
} from "../src/lib/build-info";

describe("normalizeInjected", () => {
  test("字串原樣通過，前後空白修掉", () => {
    expect(normalizeInjected("1.1.0")).toBe("1.1.0");
    expect(normalizeInjected("  53596f9  ")).toBe("53596f9");
  });

  test("define 不存在時落到 unknown —— 不可以是 undefined 或空白", () => {
    // 這是 `bun test` 與任何非 Vite 消費端的實際情況
    for (const raw of [undefined, null, "", "   ", 42, {}, []]) {
      const out = normalizeInjected(raw);
      expect(out, String(raw)).toBe(UNKNOWN_BUILD_FIELD);
      expect(out.trim(), String(raw)).not.toBe("");
    }
  });

  test("可指定 fallback —— dirty 旗標要的是 'false' 而不是 'unknown'", () => {
    expect(normalizeInjected(undefined, "false")).toBe("false");
    expect(normalizeInjected("", "")).toBe("");
  });
});

describe("formatCommit", () => {
  test("乾淨工作區 → 純雜湊", () => {
    expect(formatCommit("53596f9", false)).toBe("53596f9");
  });

  test("有未 commit 的變更 → 補 + 標記", () => {
    // 少了這個標記，「改了沒 commit 就 build」跟「乾淨 build」的字串完全相同
    expect(formatCommit("53596f9", true)).toBe("53596f9+");
    expect(formatCommit("53596f9", true)).not.toBe(formatCommit("53596f9", false));
  });

  test("取不到雜湊時不加 + —— unknown+ 讀起來像另一種錯誤", () => {
    expect(formatCommit(UNKNOWN_BUILD_FIELD, true)).toBe(UNKNOWN_BUILD_FIELD);
    expect(formatCommit("", true)).toBe(UNKNOWN_BUILD_FIELD);
  });
});

describe("formatBuildTime", () => {
  test("ISO → MM-DD HH:mm（本地時區）", () => {
    // 用本地時間建構，斷言才不會跟著跑測試的機器時區飄
    const d = new Date(2026, 7, 15, 8, 50);
    expect(formatBuildTime(d.toISOString())).toBe("08-15 08:50");
  });

  test("個位數月／日／時／分補零", () => {
    const d = new Date(2026, 0, 2, 3, 4);
    expect(formatBuildTime(d.toISOString())).toBe("01-02 03:04");
  });

  test("空值或壞字串 → unknown，不會噴出 Invalid Date", () => {
    for (const bad of ["", "   ", "not-a-date", UNKNOWN_BUILD_FIELD]) {
      expect(formatBuildTime(bad), bad).toBe(UNKNOWN_BUILD_FIELD);
    }
  });
});

describe("formatBuildStamp", () => {
  const clean: BuildInfo = {
    version: "1.1.0",
    commit: "53596f9",
    dirty: false,
    builtAt: new Date(2026, 7, 15, 8, 50).toISOString(),
  };

  test("三項齊全 → 版號 · commit · 時間", () => {
    expect(formatBuildStamp(clean)).toBe("1.1.0 · 53596f9 · 08-15 08:50");
  });

  test("髒工作區的字串必須跟乾淨的不同", () => {
    expect(formatBuildStamp({ ...clean, dirty: true })).toBe("1.1.0 · 53596f9+ · 08-15 08:50");
  });

  test("dev 路徑帶 -dev 後綴，仍保留真實 commit 與時間", () => {
    expect(formatBuildStamp({ ...clean, version: "1.1.0-dev" })).toBe(
      "1.1.0-dev · 53596f9 · 08-15 08:50",
    );
  });

  test("git 全掛掉（降級路徑）仍產出可讀字串，不含 undefined", () => {
    const degraded = formatBuildStamp({
      version: UNKNOWN_BUILD_FIELD,
      commit: UNKNOWN_BUILD_FIELD,
      dirty: false,
      builtAt: "",
    });
    expect(degraded).toBe("unknown · unknown · unknown");
    expect(degraded).not.toContain("undefined");
  });

  test("兩份不同 build 一定產生不同字串 —— 這是整個功能存在的理由", () => {
    const older: BuildInfo = { ...clean, commit: "aaaaaaa", builtAt: new Date(2026, 7, 14, 21, 5).toISOString() };
    expect(formatBuildStamp(older)).not.toBe(formatBuildStamp(clean));
  });
});
