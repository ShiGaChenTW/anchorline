import { describe, expect, test } from "bun:test";
import {
  buildCommitSystem,
  buildCommitUser,
  clampPatch,
  commitCommand,
  isUsableDraft,
  parseCommitDraft,
  parsePorcelain,
  shellQuote,
  summarizeChanges,
  SUBJECT_LIMIT,
  type Changeset,
} from "../src/lib/commit-message";

const CS = (p: Partial<Changeset> = {}): Changeset => ({
  status: "",
  stat: "",
  patch: "",
  truncated: false,
  ...p,
});

describe("parsePorcelain", () => {
  test("認得四種狀態碼", () => {
    const r = parsePorcelain(
      [
        " M src/lib/a.ts",
        "A  src/lib/b.ts",
        " D old.md",
        "?? notes.txt",
      ].join("\n"),
    );
    expect(r).toEqual([
      { path: "src/lib/a.ts", kind: "modified" },
      { path: "src/lib/b.ts", kind: "added" },
      { path: "old.md", kind: "deleted" },
      { path: "notes.txt", kind: "untracked" },
    ]);
  });

  test("改名要抓得到來源，否則訊息會說成「新增又刪除」", () => {
    const r = parsePorcelain("R  src/old-name.ts -> src/new-name.ts");
    expect(r[0]).toEqual({ path: "src/new-name.ts", kind: "renamed", from: "src/old-name.ts" });
  });

  test("index 有動、worktree 沒動時，讀第一欄", () => {
    expect(parsePorcelain("M  staged.ts")[0]?.kind).toBe("modified");
    expect(parsePorcelain("A  staged-new.ts")[0]?.kind).toBe("added");
  });

  test("認不得的狀態碼當 modified，不整行丟掉", () => {
    // 丟掉的話那個檔案會從清單裡消失，而使用者不會知道少了什麼
    const r = parsePorcelain("UU conflicted.ts");
    expect(r).toHaveLength(1);
    expect(r[0]?.kind).toBe("modified");
  });

  test("空行與過短的行略過，不產生空路徑項目", () => {
    expect(parsePorcelain("\n\n M \n")).toEqual([]);
    expect(parsePorcelain("")).toEqual([]);
  });

  test("路徑含空白照樣完整保留", () => {
    expect(parsePorcelain(" M docs/my notes.md")[0]?.path).toBe("docs/my notes.md");
  });
});

describe("summarizeChanges", () => {
  test("依類別計數", () => {
    const files = parsePorcelain([" M a.ts", " M b.ts", "A  c.ts", "?? d.txt"].join("\n"));
    expect(summarizeChanges(files)).toBe("修改 2 · 新增 1 · 未追蹤 1");
  });
});

describe("prompt", () => {
  const files = parsePorcelain(" M src/lib/a.ts\nA  src/lib/b.ts");

  test("明文禁止用檔案數量造句", () => {
    // 這條是這個功能存在的理由：「更新多個檔案」從 git status 就看得到
    const sys = buildCommitSystem({
      changeset: CS(),
      files,
      recentSubjects: [],
      conventional: false,
      language: "zh-TW",
    });
    expect(sys).toContain("不要用檔案數量造句");
    expect(sys).toContain("驗證不了");
  });

  test("conventional commits 依 repo 歷史開關，不是寫死", () => {
    const base = { changeset: CS(), files, recentSubjects: [], language: "zh-TW" as const };
    expect(buildCommitSystem({ ...base, conventional: true })).toContain("feat/fix/docs");
    expect(buildCommitSystem({ ...base, conventional: false })).toContain("不使用 conventional commits");
  });

  test("沒有 patch 時要明講，模型才不會假裝讀過 diff", () => {
    const u = buildCommitUser({
      changeset: CS({ stat: " a.ts | 2 +-" }),
      files,
      recentSubjects: [],
      conventional: false,
      language: "zh-TW",
    });
    expect(u).toContain("沒有附上差異內容");
  });

  test("patch 被截斷要標記出來", () => {
    const u = buildCommitUser({
      changeset: CS({ patch: "@@ -1 +1 @@", truncated: true }),
      files,
      recentSubjects: [],
      conventional: false,
      language: "zh-TW",
    });
    expect(u).toContain("已截斷");
  });

  test("帶入既有主旨讓模型學這個 repo 的寫法", () => {
    const u = buildCommitUser({
      changeset: CS(),
      files,
      recentSubjects: ["版號紀錄卡與左欄齊底", "自訂章節可以整節刪掉"],
      conventional: false,
      language: "zh-TW",
    });
    expect(u).toContain("版號紀錄卡與左欄齊底");
  });
});

describe("parseCommitDraft", () => {
  test("主旨與內文以空行分開", () => {
    const d = parseCommitDraft("修好側欄不重建\n\n漏了註冊點，detectRailPage 回 null。");
    expect(d.subject).toBe("修好側欄不重建");
    expect(d.body).toBe("漏了註冊點，detectRailPage 回 null。");
  });

  test("剝掉程式碼圍欄", () => {
    expect(parseCommitDraft("```\nfix: 修好了\n\n內文\n```").subject).toBe("fix: 修好了");
    expect(parseCommitDraft("```text\nfix: 修好了\n```").subject).toBe("fix: 修好了");
  });

  test("剝掉整段包住的引號，但句中的引號留著", () => {
    expect(parseCommitDraft('"修好側欄"').subject).toBe("修好側欄");
    expect(parseCommitDraft("「修好側欄」").subject).toBe("修好側欄");
    expect(parseCommitDraft('把 "active" 標記移到正確的頁面').subject).toBe(
      '把 "active" 標記移到正確的頁面',
    );
  });

  test("剝掉開場白", () => {
    const d = parseCommitDraft("以下是建議的 commit 訊息：\n修好側欄不重建\n\n內文");
    expect(d.subject).toBe("修好側欄不重建");
  });

  test("主旨過長要截並標記，不能整段塞進 -m", () => {
    const long = "改".repeat(SUBJECT_LIMIT + 20);
    const d = parseCommitDraft(long);
    expect(d.subject.length).toBe(SUBJECT_LIMIT);
    expect(d.subject.endsWith("…")).toBe(true);
  });

  test("只有主旨時內文是空字串，不是 undefined", () => {
    expect(parseCommitDraft("只有一行").body).toBe("");
  });

  test("產不出主旨就不可用", () => {
    expect(isUsableDraft(parseCommitDraft(""))).toBe(false);
    expect(isUsableDraft(parseCommitDraft("有主旨"))).toBe(true);
  });
});

describe("commitCommand", () => {
  test("單引號要跳脫成 '\\'' —— 這是 POSIX shell 唯一安全的作法", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  test("反引號與 $ 不會被 shell 執行", () => {
    // 我們自己的 commit 訊息就常有 `code` 與 $var，用雙引號包會變成命令替換
    const cmd = commitCommand({ subject: "修好 `git diff` 與 $PATH 的處理", body: "" });
    expect(cmd).toBe("git commit -m '修好 `git diff` 與 $PATH 的處理'");
    expect(cmd).not.toContain('"');
  });

  test("有內文就給第二個 -m", () => {
    const cmd = commitCommand({ subject: "主旨", body: "內文第一段\n\n第二段" });
    expect(cmd).toBe("git commit -m '主旨' -m '內文第一段\n\n第二段'");
  });

  test("空白內文不產生空的 -m", () => {
    expect(commitCommand({ subject: "主旨", body: "   \n  " })).toBe("git commit -m '主旨'");
  });
});

describe("clampPatch", () => {
  test("沒超過就原樣回，truncated 為 false", () => {
    expect(clampPatch("abc", 10)).toEqual({ patch: "abc", truncated: false });
  });

  test("超過就截斷並標記 —— 靜靜送出整份 diff 才是真正的問題", () => {
    const r = clampPatch("x".repeat(50), 10);
    expect(r.patch).toHaveLength(10);
    expect(r.truncated).toBe(true);
  });
});
