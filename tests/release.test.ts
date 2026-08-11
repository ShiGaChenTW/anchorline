import { describe, expect, test } from "bun:test";
import {
  buildHandoff,
  checkVersionFormat,
  draftRelease,
  isVersionTaken,
  lastVersionOf,
  releaseProgress,
  validateVersion,
  type Release,
} from "../src/lib/release";

function rel(over: Partial<Release> = {}): Release {
  return {
    id: "r1",
    projectId: "p1",
    version: "v1.0.0",
    title: "",
    note: "",
    status: "draft",
    items: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    handedAt: null,
    ...over,
  };
}

describe("checkVersionFormat", () => {
  test("空白不行 —— 這個欄位只有使用者能決定", () => {
    expect(checkVersionFormat("   ").ok).toBe(false);
  });

  // 預設仍是 loose —— 版號政策是每個專案自己選一次（Scott 2026-08-12）
  test("loose：常見慣例都放行，不強迫 semver", () => {
    for (const v of ["v1.0.0", "1.2.3", "2026.08", "R42", "v0.1.0-beta.1", "sprint-14"]) {
      expect(checkVersionFormat(v).ok).toBe(true);
    }
  });

  test("strict：只放行 vX.YY.ZZ", () => {
    for (const v of ["v1.00.00", "v1.02.15", "v12.00.00"]) {
      expect(checkVersionFormat(v, "strict").ok).toBe(true);
    }
    for (const v of ["v1.0.0", "1.2.3", "2026.08", "R42"]) {
      expect(checkVersionFormat(v, "strict").ok).toBe(false);
    }
  });

  test("中間有空白不行", () => {
    expect(checkVersionFormat("v1 0").ok).toBe(false);
  });

  test("git tag 不接受的字元要擋掉", () => {
    for (const v of ["v1~1", "v1^1", "v1:1", "v1?", "v1*", "v1[a]", "a/b", "v1@{}"]) {
      expect(checkVersionFormat(v).ok).toBe(false);
    }
  });

  test("不能以 . 或 - 開頭結尾", () => {
    for (const v of [".v1", "v1.", "-v1", "v1-"]) {
      expect(checkVersionFormat(v).ok).toBe(false);
    }
  });

  test("太長要擋", () => {
    expect(checkVersionFormat("v".repeat(41)).ok).toBe(false);
  });

  test("錯誤訊息說得出原因", () => {
    const r = checkVersionFormat("v1 0");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(4);
  });
});

describe("isVersionTaken", () => {
  const releases = [rel({ id: "a", version: "v1.0.0" }), rel({ id: "b", version: "V2.0.0" })];

  test("同專案重複要抓到", () => {
    expect(isVersionTaken("v1.0.0", "p1", releases)).toBe(true);
  });
  test("忽略大小寫", () => {
    expect(isVersionTaken("v2.0.0", "p1", releases)).toBe(true);
  });
  test("忽略前後空白", () => {
    expect(isVersionTaken("  v1.0.0 ", "p1", releases)).toBe(true);
  });
  test("不同專案可以用同一個版號", () => {
    expect(isVersionTaken("v1.0.0", "p2", releases)).toBe(false);
  });
  test("編輯自己時不算重複", () => {
    expect(isVersionTaken("v1.0.0", "p1", releases, "a")).toBe(false);
  });
});

describe("validateVersion", () => {
  test("格式錯先報格式", () => {
    const r = validateVersion("v1 0", "p1", []);
    expect(r.ok).toBe(false);
  });
  test("重複要報重複", () => {
    const r = validateVersion("v1.0.0", "p1", [rel()]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("已經用過");
  });
  test("沒問題就通過", () => {
    expect(validateVersion("v1.1.0", "p1", [rel()]).ok).toBe(true);
  });
});

describe("lastVersionOf", () => {
  test("依建立時間取最新的，不做版號大小比較", () => {
    const list = [
      rel({ id: "a", version: "v9.0.0", createdAt: "2026-01-01T00:00:00.000Z" }),
      rel({ id: "b", version: "v2.0.0", createdAt: "2026-08-01T00:00:00.000Z" }),
    ];
    expect(lastVersionOf("p1", list)).toBe("v2.0.0");
  });
  test("沒有就回 null，不要編一個出來", () => {
    expect(lastVersionOf("p1", [])).toBeNull();
  });
  test("只看自己專案", () => {
    expect(lastVersionOf("p2", [rel()])).toBeNull();
  });
});

describe("draftRelease", () => {
  test("版號留白 —— 系統不預設任何值", () => {
    const d = draftRelease("p1", "r9", "2026-08-08T00:00:00.000Z");
    expect(d.version).toBe("");
    expect(d.items).toEqual([]);
    expect(d.status).toBe("draft");
    expect(d.handedAt).toBeNull();
  });
});

describe("releaseProgress", () => {
  test("空的是 0/0 且不會除以零", () => {
    expect(releaseProgress(rel())).toEqual({ done: 0, planned: 0, total: 0, pct: 0 });
  });
  test("混合狀態算得對", () => {
    const r = rel({
      items: [
        { id: "1", text: "a", state: "done", source: "manual" },
        { id: "2", text: "b", state: "planned", source: "manual" },
        { id: "3", text: "c", state: "planned", source: "manual" },
      ],
    });
    expect(releaseProgress(r)).toEqual({ done: 1, planned: 2, total: 3, pct: 33 });
  });
});

describe("buildHandoff", () => {
  const r = rel({
    version: "v1.4.0",
    title: "結帳改版",
    note: "這一版只動行動端。",
    items: [
      { id: "1", text: "單頁結帳骨架", state: "done", source: "section", ref: "scope" },
      { id: "2", text: "Apple Pay 接入", state: "planned", source: "manual" },
      { id: "3", text: "錯誤訊息處理", state: "planned", source: "manual" },
    ],
  });
  const md = buildHandoff(r, "結帳專案");

  test("標題含版號", () => {
    expect(md).toContain("# 版本交辦：v1.4.0 — 結帳改版");
  });

  test("明說版號由使用者指定", () => {
    expect(md).toContain("（由使用者指定）");
    expect(md).toContain("不要自行改動或遞增");
  });

  test("待開發排在已完成前面 —— 那才是要交辦的事", () => {
    expect(md.indexOf("## 待開發")).toBeLessThan(md.indexOf("## 已完成"));
  });

  test("checkbox 狀態對應項目狀態", () => {
    expect(md).toContain("- [ ] Apple Pay 接入");
    expect(md).toContain("- [x] 單頁結帳骨架");
  });

  test("帶了來源 ref 就附上", () => {
    expect(md).toContain("`scope`");
  });

  test("進度與專案名都在裡面", () => {
    expect(md).toContain("1/3 已完成（33%）");
    expect(md).toContain("結帳專案");
  });

  test("有說明才出現說明段", () => {
    expect(md).toContain("## 版本說明");
    expect(buildHandoff(rel({ note: "" }), "x")).not.toContain("## 版本說明");
  });

  test("兩邊都空時寫「（無）」而不是留空段落", () => {
    const md2 = buildHandoff(rel({ version: "v0.1" }), "x");
    expect(md2.match(/（無）/g)?.length).toBe(2);
  });

  test("收尾附上標版指令，版號用使用者填的那個", () => {
    expect(md).toContain("git tag -a v1.4.0");
  });
});
