import { describe, expect, test } from "bun:test";
import { gitHeadline, type GitStats } from "../src/lib/project-stats";

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

describe("gitHeadline", () => {
  test("沒有 git 資料就是不是 git 專案", () => {
    expect(gitHeadline(undefined)).toEqual({
      text: "這個資料夾不是 git 專案",
      tone: "info",
    });
  });

  test("剛 init、還沒 commit", () => {
    expect(gitHeadline(git({ commitCount: 0, head: "", lastMessage: "", ahead: -1 }))).toEqual({
      text: "已起版控，還沒有第一次提交",
      tone: "info",
    });
  });

  test("剛 init 但資料夾已有檔案", () => {
    expect(
      gitHeadline(git({ commitCount: 0, head: "", dirtyCount: 12, ahead: -1 })),
    ).toEqual({
      text: "已起版控，12 個檔案還沒提交",
      tone: "warn",
    });
  });

  test("有 commit 之後未提交不再加「已起版控」", () => {
    expect(gitHeadline(git({ dirtyCount: 3 }))).toEqual({
      text: "3 個檔案還沒提交",
      tone: "warn",
    });
  });
});
