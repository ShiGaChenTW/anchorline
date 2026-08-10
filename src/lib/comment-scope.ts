/**
 * 留言的專案歸屬與覆核資格 —— 純邏輯。
 *
 * 抽出來的理由跟 `prd-versions.ts` 一樣：`store.ts` 的相依鏈用了 Vite 專屬的
 * `import.meta.glob`，在 bun test 裡載不進來。而「誰可以把誰的留言標記已解決」
 * 正是最不該靠手動點擊驗證的那種規則 —— 判錯不會有任何錯誤訊息，只會靜靜地
 * 讓不該過的過、該過的被擋。
 */
import type { Comment, Employee, Project } from "../data/types";

/** 這則留言所屬的專案。找不到就是 null —— 呼叫端必須處理，不要退回猜測。 */
export function projectOfComment(
  comment: Pick<Comment, "projectId">,
  projects: readonly Project[],
): Project | null {
  return projects.find((p) => p.id === comment.projectId) ?? null;
}

/** 某個專案底下的留言 */
export function commentsOfProject(comments: readonly Comment[], projectId: string): Comment[] {
  return comments.filter((c) => c.projectId === projectId);
}

/** 某個專案底下未解決的留言數 */
export function openCommentCount(comments: readonly Comment[], projectId: string): number {
  return commentsOfProject(comments, projectId).filter((c) => !c.resolved).length;
}

/**
 * 舊存檔相容：補上缺少的 projectId。
 * 不掛的話那些留言會變成孤兒 —— 任何專案都看不到，也永遠無法標記已解決。
 */
export function migrateComments(
  comments: readonly Comment[],
  fallbackProjectId: string,
): Comment[] {
  if (comments.every((c) => c.projectId)) return comments as Comment[];
  return comments.map((c) => (c.projectId ? c : { ...c, projectId: fallbackProjectId }));
}

export type ResolveCheck = { ok: boolean; reason?: string };

/**
 * 可以把這則留言標記已解決嗎。
 *
 * 規則順序刻意如此：先確認留言歸屬（找不到專案就不該再往下猜），
 * 再看角色資格，最後才看自審。
 */
export function canResolveComment(opts: {
  user: Employee | null | undefined;
  project: Project | null;
  hasPeerReview: boolean;
  hasApprove: boolean;
}): ResolveCheck {
  const { user, project, hasPeerReview, hasApprove } = opts;
  if (!user) return { ok: false, reason: "尚未登入" };
  if (!project) return { ok: false, reason: "找不到這則留言所屬的專案" };
  if (user.accessRole === "admin") return { ok: true };
  if (!hasPeerReview && !hasApprove) return { ok: false, reason: "無權覆核" };
  // 編輯人員不可覆核自己的文件 —— 自己消化自己的問題等於沒有覆核
  if (user.accessRole === "editor" && project.authorId === user.id) {
    return { ok: false, reason: "編輯人員不可覆核自己的檔案" };
  }
  return { ok: true };
}
