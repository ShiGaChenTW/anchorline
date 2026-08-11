import { describe, expect, test } from "bun:test";
import {
  canAddItem,
  claimedRefs,
  formatVersion,
  levelGate,
  levelOfBump,
  parseVersion,
  pushGate,
  refOwner,
  suggestNext,
  tagCommand,
  VERSION_RE,
} from "../src/lib/release-track";
import { checkVersionFormat, policyOf } from "../src/lib/release";
import type { Release, ReleaseItem } from "../src/lib/release";

function item(p: Partial<ReleaseItem> & { id: string }): ReleaseItem {
  return { text: p.id, state: "done", source: "commit", ...p } as ReleaseItem;
}

function rel(p: Partial<Release> & { id: string }): Release {
  return {
    projectId: "p1",
    version: "v1.00.00",
    title: "",
    note: "",
    status: "draft",
    items: [],
    createdAt: "2026-08-12T00:00:00Z",
    updatedAt: "2026-08-12T00:00:00Z",
    handedAt: null,
    releasedAt: null,
    ...p,
  } as Release;
}

const NO_FACTS = { hasApprovedPrd: false, items: [] as ReleaseItem[] };

describe("版號格式 vX.YY.ZZ", () => {
  test("YY 與 ZZ 固定兩位補零", () => {
    expect(VERSION_RE.test("v1.00.00")).toBe(true);
    expect(VERSION_RE.test("v1.02.15")).toBe(true);
    expect(VERSION_RE.test("v12.00.00")).toBe(true); // X 不限位數
  });

  test("少補零就是不合格 —— 格式是規則的載體，不只是外觀", () => {
    expect(VERSION_RE.test("v1.0.0")).toBe(false);
    expect(VERSION_RE.test("v1.2.3")).toBe(false);
    expect(VERSION_RE.test("1.00.00")).toBe(false); // 缺 v
    expect(VERSION_RE.test("v1.000.00")).toBe(false); // 三位
    expect(VERSION_RE.test("2026.08")).toBe(false);
    expect(VERSION_RE.test("R42")).toBe(false);
  });

  test("checkVersionFormat 的訊息要說得出正確形狀", () => {
    const r = checkVersionFormat("v1.2.3", "strict");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("v1.02.00");
  });

  test("空白仍然擋掉", () => {
    expect(checkVersionFormat("   ", "strict").ok).toBe(false);
  });

  test("parse 與 format 互為反向", () => {
    expect(parseVersion("v2.07.13")).toEqual({ major: 2, minor: 7, patch: 13 });
    expect(formatVersion({ major: 2, minor: 7, patch: 13 })).toBe("v2.07.13");
    expect(parseVersion("v1.2.3")).toBeNull();
  });
});

describe("suggestNext", () => {
  test("三個層級各自進位並歸零右側", () => {
    expect(suggestNext("v1.02.05", "major")).toBe("v2.00.00");
    expect(suggestNext("v1.02.05", "minor")).toBe("v1.03.00");
    expect(suggestNext("v1.02.05", "patch")).toBe("v1.02.06");
  });

  test("沒有上一版時從 0 起算", () => {
    expect(suggestNext(null, "major")).toBe("v1.00.00");
    expect(suggestNext(null, "patch")).toBe("v0.00.01");
  });

  test("上一版格式不合就當成沒有，不要炸掉", () => {
    expect(suggestNext("R42", "minor")).toBe("v0.01.00");
  });
});

describe("levelOfBump", () => {
  test("看動了哪一段", () => {
    expect(levelOfBump("v1.02.05", "v2.00.00")).toBe("major");
    expect(levelOfBump("v1.02.05", "v1.03.00")).toBe("minor");
    expect(levelOfBump("v1.02.05", "v1.02.06")).toBe("patch");
  });

  test("完全沒動或格式不合回 null", () => {
    expect(levelOfBump("v1.02.05", "v1.02.05")).toBeNull();
    expect(levelOfBump("v1.02.05", "v1.2.6")).toBeNull();
  });
});

describe("取號閘門", () => {
  test("X 要有完成的 PRD 簽核紀錄", () => {
    const g = levelGate("major", NO_FACTS);
    expect(g.ok).toBe(false);
    // 擋下來要說得出下一步，否則使用者只能猜
    if (!g.ok) expect(g.fix).toContain("送審");
  });

  test("X 有簽核就放行", () => {
    expect(levelGate("major", { hasApprovedPrd: true, items: [] }).ok).toBe(true);
  });

  test("YY 必須收過 openspec change", () => {
    const withCommit = levelGate("minor", {
      hasApprovedPrd: true,
      items: [{ source: "commit", ref: "abc1234" }],
    });
    expect(withCommit.ok).toBe(false);
    if (!withCommit.ok) expect(withCommit.fix).toContain("OpenSpec");

    const withChange = levelGate("minor", {
      hasApprovedPrd: false,
      items: [{ source: "change", ref: "audit-export" }],
    });
    expect(withChange.ok).toBe(true);
  });

  test("YY 不看 PRD 簽核 —— 那是 X 的條件", () => {
    expect(
      levelGate("minor", { hasApprovedPrd: false, items: [{ source: "change", ref: "x" }] }).ok,
    ).toBe(true);
  });

  test("ZZ 只要有收東西就好", () => {
    expect(levelGate("patch", { hasApprovedPrd: false, items: [] }).ok).toBe(false);
    expect(
      levelGate("patch", { hasApprovedPrd: false, items: [{ source: "commit", ref: "abc" }] }).ok,
    ).toBe(true);
  });
});

describe("commit 佔用", () => {
  const r1 = rel({ id: "r1", version: "v1.00.00", items: [item({ id: "i1", ref: "abc1234" })] });
  const r2 = rel({ id: "r2", version: "v1.00.01" });

  test("已被別版收走就不能再收，訊息要指名是哪一版", () => {
    const c = canAddItem(r2, { source: "commit", ref: "abc1234" }, [r1, r2]);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toContain("v1.00.00");
  });

  test("排除自己 —— 否則編輯中的版號會說自己佔用了自己", () => {
    expect(refOwner("abc1234", "p1", [r1], "r1")).toBeNull();
    expect(refOwner("abc1234", "p1", [r1])?.id).toBe("r1");
  });

  test("佔用只在同一個專案內計算", () => {
    const other = rel({ id: "r9", projectId: "p2", items: [item({ id: "x", ref: "zzz" })] });
    expect(refOwner("zzz", "p1", [other])).toBeNull();
  });

  test("claimedRefs 排除自己那一版", () => {
    expect(claimedRefs("p1", [r1, r2]).has("abc1234")).toBe(true);
    expect(claimedRefs("p1", [r1], "r1").size).toBe(0);
  });

  test("放行後不能再改內容", () => {
    const released = rel({ id: "r3", releasedAt: "2026-08-12T01:00:00Z" });
    const c = canAddItem(released, { source: "commit", ref: "new" }, [released]);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toContain("已經放行");
  });
});

describe("PUSH 閘門：取號 ≠ 放行", () => {
  const facts = { hasApprovedPrd: true, items: [{ source: "commit" as const, ref: "abc" }] };

  test("格式不合擋在最前面", () => {
    const g = pushGate(rel({ id: "r", version: "v1.0.0" }), facts);
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reason).toContain("vX.YY.ZZ");
  });

  test("層級閘門沒過就不能 push", () => {
    const r = rel({
      id: "r",
      version: "v2.00.00",
      level: "major",
      items: [item({ id: "i" })],
      releasedAt: "2026-08-12T01:00:00Z",
    });
    const g = pushGate(r, { hasApprovedPrd: false, items: r.items });
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reason).toContain("PRD 簽核");
  });

  test("取了號但還沒放行 —— 這是預先作業的正常狀態，不是錯誤", () => {
    const r = rel({ id: "r", version: "v1.00.01", level: "patch", items: [item({ id: "i" })] });
    const g = pushGate(r, facts);
    expect(g.ok).toBe(false);
    if (!g.ok) {
      expect(g.reason).toContain("還沒放行");
      expect(g.fix).toContain("正式放行");
    }
  });

  test("放行之後才給指令", () => {
    const r = rel({
      id: "r",
      version: "v1.00.01",
      level: "patch",
      items: [item({ id: "i" })],
      releasedAt: "2026-08-12T01:00:00Z",
    });
    const g = pushGate(r, facts);
    expect(g.ok).toBe(true);
    if (g.ok) expect(g.command).toContain("git tag -a v1.00.01");
  });

  test("規則上路前的舊版號沒有 level，不套層級閘門", () => {
    // 回頭補判定只會把已經發出去的版號變成「不合法」
    const old = rel({
      id: "old",
      version: "v0.09.00",
      items: [item({ id: "i" })],
      releasedAt: "2026-01-01T00:00:00Z",
    });
    expect(pushGate(old, { hasApprovedPrd: false, items: old.items }).ok).toBe(true);
  });
});

describe("tagCommand", () => {
  test("產生標籤與推送兩行", () => {
    expect(tagCommand("v1.02.00")).toBe(
      'git tag -a v1.02.00 -m "v1.02.00"\ngit push origin v1.02.00',
    );
  });
});

describe("版號政策：每個專案選一次，選了 strict 回不去", () => {
  test("沒設過的專案是 loose —— 那是這條規則出現之前的行為", () => {
    expect(policyOf(undefined)).toBe("loose");
    expect(policyOf(null)).toBe("loose");
    expect(policyOf({})).toBe("loose");
  });

  test("認得 strict", () => {
    expect(policyOf({ versionPolicy: "strict" })).toBe("strict");
  });

  test("loose 政策下不套層級閘門 —— 那些段落在 loose 沒有意義", () => {
    // v1.2.3 在 strict 是不合格的，在 loose 是正常的
    const r = rel({
      id: "r",
      version: "v1.2.3",
      items: [item({ id: "i" })],
      releasedAt: "2026-08-12T01:00:00Z",
    });
    expect(pushGate(r, { hasApprovedPrd: false, items: r.items }, "loose").ok).toBe(true);
    expect(pushGate(r, { hasApprovedPrd: false, items: r.items }, "strict").ok).toBe(false);
  });

  test("loose 一樣要放行才能 push —— 取號與放行分離跟政策無關", () => {
    const r = rel({ id: "r", version: "2026.08", items: [item({ id: "i" })] });
    const g = pushGate(r, { hasApprovedPrd: false, items: r.items }, "loose");
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reason).toContain("還沒放行");
  });

  test("loose 仍然擋空版號", () => {
    const r = rel({ id: "r", version: "  ", releasedAt: "2026-08-12T01:00:00Z" });
    expect(pushGate(r, { hasApprovedPrd: true, items: [] }, "loose").ok).toBe(false);
  });
});
