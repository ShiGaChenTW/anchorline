import { describe, expect, test } from "bun:test";
import {
  buildSnapshot,
  latestSnapshot,
  parseSnapshotTime,
  PER_FILE_LIMIT,
  snapshotFileName,
  snapshotSlug,
  staleness,
  STALE_DAYS,
} from "../src/lib/project-snapshot";

describe("檔名", () => {
  test("不安全字元換成 -，不是丟掉", () => {
    expect(snapshotSlug("My Project/Name")).toBe("My-Project-Name");
    expect(snapshotSlug("  a:b*c  ")).toBe("a-b-c");
  });

  test("空的或全是符號時給保底名，不產生 `-2026….md`", () => {
    expect(snapshotSlug("")).toBe("project");
    expect(snapshotSlug("///")).toBe("project");
  });

  test("帶時間戳，同一分鐘內才會撞名", () => {
    const at = new Date("2026-08-12T09:05:00");
    expect(snapshotFileName("Anchorline", at)).toBe("Anchorline-20260812-0905.md");
  });

  test("時間讀得回來", () => {
    const n = snapshotFileName("X", new Date("2026-01-02T03:04:00"));
    expect(parseSnapshotTime(n)?.getFullYear()).toBe(2026);
    expect(parseSnapshotTime(n)?.getMinutes()).toBe(4);
  });

  test("認不得的檔名回 null，不讓畫面壞掉", () => {
    // 使用者自己丟進來的檔不該讓整個清單炸掉
    expect(parseSnapshotTime("隨手筆記.md")).toBeNull();
    expect(parseSnapshotTime("x-2026-0812.md")).toBeNull();
  });
});

describe("latestSnapshot", () => {
  test("取最新的一份", () => {
    const r = latestSnapshot([
      { name: "p-20260810-0900.md", mtimeMs: 1 },
      { name: "p-20260812-0900.md", mtimeMs: 1 },
      { name: "p-20260811-0900.md", mtimeMs: 1 },
    ]);
    expect(r?.name).toBe("p-20260812-0900.md");
  });

  test("時間優先讀檔名 —— 複製或搬動會讓 mtime 說謊", () => {
    const r = latestSnapshot([
      { name: "p-20260812-0900.md", mtimeMs: 0 }, // mtime 很舊但檔名最新
      { name: "p-20260101-0900.md", mtimeMs: Date.now() },
    ]);
    expect(r?.name).toBe("p-20260812-0900.md");
  });

  test("檔名沒有時間就退回 mtime", () => {
    const r = latestSnapshot([{ name: "手動.md", mtimeMs: Date.parse("2026-08-12T00:00:00Z") }]);
    expect(r?.name).toBe("手動.md");
  });

  test("沒有檔案回 null", () => {
    expect(latestSnapshot([])).toBeNull();
  });
});

describe("落後多少", () => {
  const at = new Date("2026-08-01T00:00:00Z");
  const now = Date.parse("2026-08-03T00:00:00Z");

  test("只算快照之後的 commit", () => {
    const s = staleness(at, ["2026-07-30T00:00:00Z", "2026-08-02T00:00:00Z", "2026-08-02T12:00:00Z"], now);
    expect(s.commitsBehind).toBe(2);
    expect(s.stale).toBe(true);
  });

  test("沒有新 commit 且還新 → 不提醒", () => {
    const s = staleness(at, ["2026-07-30T00:00:00Z"], now);
    expect(s.commitsBehind).toBe(0);
    expect(s.stale).toBe(false);
  });

  test("沒有新 commit 但太舊也要提醒 —— 沒進版控的改動一樣會讓快照過期", () => {
    const old = new Date("2026-01-01T00:00:00Z");
    const s = staleness(old, [], now);
    expect(s.commitsBehind).toBe(0);
    expect(s.stale).toBe(true);
    expect(s.ageMs).toBeGreaterThan(STALE_DAYS * 86400000);
  });

  test("壞掉的時間字串略過，不算成落後", () => {
    expect(staleness(at, ["", "not-a-date"], now).commitsBehind).toBe(0);
  });
});

describe("摘要組裝", () => {
  const base = {
    projectName: "Anchorline",
    rootPath: "/tmp/x",
    at: new Date("2026-08-12T00:00:00Z"),
    gitLine: "main · 12 commits",
    truncated: false,
  };

  test("檔案清單放在內容之前 —— 人只想先知道讀到了哪些", () => {
    const md = buildSnapshot({ ...base, files: [{ path: "a.ts", text: "x" }] });
    expect(md.indexOf("## 檔案清單")).toBeLessThan(md.indexOf("## 內容"));
    expect(md).toContain("- `a.ts`");
  });

  test("截斷過要在最上面講出來", () => {
    const md = buildSnapshot({ ...base, files: [], truncated: true });
    expect(md).toContain("沒有讀完整個資料夾");
    expect(md.indexOf("沒有讀完整個資料夾")).toBeLessThan(md.indexOf("## 檔案清單"));
  });

  test("單一檔案有上限，一個大檔不能吃掉整份", () => {
    const md = buildSnapshot({ ...base, files: [{ path: "big.ts", text: "y".repeat(PER_FILE_LIMIT + 500) }] });
    expect(md).toContain("（截斷）");
    expect(md.length).toBeLessThan(PER_FILE_LIMIT + 2000);
  });

  test("沒有 git 時不印空的版控行", () => {
    const md = buildSnapshot({ ...base, gitLine: "", files: [] });
    expect(md).not.toContain("**版控：**");
  });
});
