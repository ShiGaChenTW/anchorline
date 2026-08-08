import { describe, expect, test } from "bun:test";
import { diagnoseGit, hasActionableIssue, usesConventionalCommits } from "../src/lib/git-doctor";
import type { GitStats } from "../src/lib/project-stats";

function git(over: Partial<GitStats> = {}): GitStats {
  return {
    head: "abc1234",
    branch: "main",
    lastMessage: "feat: x",
    lastAt: "2026-08-08T10:00:00Z",
    author: "Scott",
    dirtyCount: 0,
    remote: "github.com/x/y.git",
    ahead: 0,
    behind: 0,
    tag: "v1.0.0",
    commitCount: 10,
    ...over,
  };
}

const ids = (g?: GitStats) => diagnoseGit(g).map((i) => i.id);

describe("diagnoseGit", () => {
  test("乾淨且同步時沒有任何問題", () => {
    expect(diagnoseGit(git())).toEqual([]);
  });

  test("不是 git 專案時給 git init", () => {
    const out = diagnoseGit(undefined);
    expect(out.map((i) => i.id)).toEqual(["not-a-repo"]);
    expect(out[0].commands[0]).toBe("git init");
  });

  test("沒有 remote 是 block —— 只存在一台機器上", () => {
    const out = diagnoseGit(git({ remote: "" }));
    const hit = out.find((i) => i.id === "no-remote")!;
    expect(hit.level).toBe("block");
    expect(hit.commands[0]).toContain("git remote add origin");
  });

  test("有 remote 但沒 upstream（ahead=-1）只算 warn，且 push 要帶 -u", () => {
    const out = diagnoseGit(git({ ahead: -1, branch: "feat/x" }));
    const hit = out.find((i) => i.id === "no-upstream")!;
    expect(hit.level).toBe("warn");
    expect(hit.commands).toEqual(["git push -u origin feat/x"]);
  });

  test("沒有 remote 時不重複報 no-upstream —— 那是同一件事的下游", () => {
    expect(ids(git({ remote: "", ahead: -1 }))).toEqual(["no-remote"]);
  });

  test("少量未提交是 warn，用 git add -A", () => {
    const hit = diagnoseGit(git({ dirtyCount: 3 })).find((i) => i.id === "dirty")!;
    expect(hit.level).toBe("warn");
    expect(hit.commands).toContain("git add -A");
  });

  test("大量未提交升為 block，並改建議 git add -p 分批", () => {
    const hit = diagnoseGit(git({ dirtyCount: 52 })).find((i) => i.id === "dirty")!;
    expect(hit.level).toBe("block");
    expect(hit.commands.some((c) => c.startsWith("git add -p"))).toBe(true);
    expect(hit.commands).not.toContain("git add -A");
  });

  test("落後要先 pull --rebase", () => {
    const hit = diagnoseGit(git({ behind: 4 })).find((i) => i.id === "behind")!;
    expect(hit.commands).toEqual(["git pull --rebase"]);
  });

  test("領先只是 info，push 不帶 -u", () => {
    const hit = diagnoseGit(git({ ahead: 2 })).find((i) => i.id === "ahead")!;
    expect(hit.level).toBe("info");
    expect(hit.commands).toEqual(["git push"]);
  });

  test("沒有 upstream 時不報 ahead / behind —— 那兩個數字沒有意義", () => {
    const out = ids(git({ ahead: -1, behind: 3 }));
    expect(out).not.toContain("ahead");
    expect(out).not.toContain("behind");
  });

  test("commit 夠多但沒 tag 才提醒", () => {
    expect(ids(git({ tag: "", commitCount: 30 }))).toContain("no-tag");
    expect(ids(git({ tag: "", commitCount: 29 }))).not.toContain("no-tag");
  });

  test("依嚴重度排序：block 在最前面", () => {
    const out = diagnoseGit(git({ remote: "", dirtyCount: 2, ahead: -1 }));
    expect(out[0].level).toBe("block");
    expect(out.map((i) => i.level)).toEqual([...out.map((i) => i.level)].sort());
  });

  test("截圖裡的真實情境：52 未提交 + 未設定 origin", () => {
    const out = diagnoseGit(git({ dirtyCount: 52, remote: "", ahead: -1, tag: "" }));
    expect(out.map((i) => i.id)).toEqual(["no-remote", "dirty"]);
    expect(out.every((i) => i.commands.length > 0)).toBe(true);
  });

  test("每一條建議都有理由", () => {
    const out = diagnoseGit(git({ dirtyCount: 52, remote: "", behind: 1 }));
    expect(out.every((i) => i.why.trim().length > 10)).toBe(true);
  });

  test("不產生任何會自動執行的東西 —— 全是文字指令", () => {
    for (const i of diagnoseGit(git({ dirtyCount: 52, remote: "" }))) {
      for (const c of i.commands) expect(typeof c).toBe("string");
    }
  });
});

describe("hasActionableIssue", () => {
  test("只有 info 不打擾", () => {
    expect(hasActionableIssue(diagnoseGit(git({ ahead: 2 })))).toBe(false);
  });
  test("有 warn 就該提醒", () => {
    expect(hasActionableIssue(diagnoseGit(git({ dirtyCount: 1 })))).toBe(true);
  });
  test("沒問題就是 false", () => {
    expect(hasActionableIssue(diagnoseGit(git()))).toBe(false);
  });
});

describe("usesConventionalCommits", () => {
  test("過半符合就算採用", () => {
    expect(usesConventionalCommits(["feat: a", "fix(x): b", "隨手改一下"])).toBe(true);
  });
  test("多數不符合就不算", () => {
    expect(usesConventionalCommits(["改一下", "再改", "feat: a"])).toBe(false);
  });
  test("空清單不算", () => {
    expect(usesConventionalCommits([])).toBe(false);
  });
  test("認得 ! 破壞性標記與 scope", () => {
    expect(usesConventionalCommits(["refactor(api)!: drop v1"])).toBe(true);
  });
});
