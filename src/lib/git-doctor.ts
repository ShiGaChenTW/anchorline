/**
 * 版控健檢 —— 把量到的 git 狀態翻成「你該下哪一行指令」。
 *
 * **範圍邊界（重要）**：這裡只**產生建議指令**，不執行任何 git 寫入。
 *
 * 唯一的執行例外是儀表板「不是 git 專案」時的 `git init` 按鈕
 * （`native.gitInit`）：可逆、不外流、參數寫死。commit / push / remote add
 * 仍不從這裡跑——那些大多不可逆或難以回頭。
 *
 * 純函式、零 I/O，方便直接測。
 */
import type { GitStats } from "./project-stats";

export type IssueLevel = "block" | "warn" | "info";

export type GitIssue = {
  id: string;
  level: IssueLevel;
  /** 一句話說「現在是什麼狀況」 */
  title: string;
  /** 為什麼這是問題 —— 沒有理由的建議不該被接受 */
  why: string;
  /** 建議指令，依序執行 */
  commands: string[];
};

/**
 * 依嚴重度排序：會擋住工作的排前面。
 * block = 現在就會出事；warn = 遲早會出事；info = 知道就好。
 */
const LEVEL_RANK: Record<IssueLevel, number> = { block: 0, warn: 1, info: 2 };

/** 從最近的 commit 主旨猜這個 repo 用不用 conventional commits */
export function usesConventionalCommits(subjects: readonly string[]): boolean {
  if (!subjects.length) return false;
  const re = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]*\))?!?:\s/;
  const hits = subjects.filter((s) => re.test(s)).length;
  return hits / subjects.length >= 0.5;
}

/** 沒有 upstream 時，push 指令要帶 -u；有了就不用 */
function pushCommand(branch: string, hasUpstream: boolean): string {
  const b = branch || "HEAD";
  return hasUpstream ? "git push" : `git push -u origin ${b}`;
}

export function diagnoseGit(g: GitStats | undefined): GitIssue[] {
  if (!g) {
    return [
      {
        id: "not-a-repo",
        level: "info",
        title: "這個資料夾不是 git 專案",
        why: "沒有版本控制，改壞了沒有東西可以回頭。",
        commands: ["git init", "git add -A", 'git commit -m "chore: initial commit"'],
      },
    ];
  }

  const out: GitIssue[] = [];
  const branch = g.branch || "";
  const hasUpstream = g.ahead >= 0;

  if (!g.remote) {
    out.push({
      id: "no-remote",
      level: "block",
      title: "沒有設定 remote",
      why: "所有紀錄只在這台機器上。硬碟壞掉就全沒了，也沒辦法跟別人協作。",
      commands: [
        "git remote add origin <你的 repo 網址>",
        pushCommand(branch, false),
      ],
    });
  } else if (!hasUpstream) {
    out.push({
      id: "no-upstream",
      level: "warn",
      title: `分支 ${branch || "（未知）"} 沒有追蹤遠端`,
      why: "看不出領先或落後幾個 commit，push 也要每次都打完整參數。",
      commands: [pushCommand(branch, false)],
    });
  }

  if (g.dirtyCount > 0) {
    out.push({
      id: "dirty",
      level: g.dirtyCount >= 20 ? "block" : "warn",
      title: `${g.dirtyCount} 個檔案還沒提交`,
      why:
        g.dirtyCount >= 20
          ? "累積這麼多才提交，之後要找出「哪一次改壞的」幾乎不可能。先看一遍再分批提交。"
          : "還沒進版控的改動，關掉編輯器就可能救不回來。",
      commands: [
        "git status",
        ...(g.dirtyCount >= 20
          ? ["git add -p   # 分批挑選，不要一次 git add -A"]
          : ["git add -A"]),
        'git commit -m "<訊息>"',
      ],
    });
  }

  if (hasUpstream && g.behind > 0) {
    out.push({
      id: "behind",
      level: "warn",
      title: `落後 origin ${g.behind} 個 commit`,
      why: "在舊的基礎上繼續做，等一下合併會撞在一起。先拉再動。",
      commands: ["git pull --rebase"],
    });
  }

  if (hasUpstream && g.ahead > 0) {
    out.push({
      id: "ahead",
      level: "info",
      title: `已提交但還沒推上去（領先 ${g.ahead} 個）`,
      why: "commit 只存在本機，遠端還看不到。",
      commands: [pushCommand(branch, true)],
    });
  }

  if (!g.tag && g.commitCount >= 30) {
    out.push({
      id: "no-tag",
      level: "info",
      title: `${g.commitCount} 個 commit 但一個 tag 都沒有`,
      why: "沒有版號就沒有「回到上一個可用版本」這個選項。",
      commands: ["git tag -a v0.1.0 -m 'v0.1.0'", "git push --tags"],
    });
  }

  return out.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
}

/** 有沒有值得跳出來的問題 —— 只有 info 就不用打擾 */
export function hasActionableIssue(issues: readonly GitIssue[]): boolean {
  return issues.some((i) => i.level !== "info");
}
