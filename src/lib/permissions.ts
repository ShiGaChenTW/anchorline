import type { AccessRole, ActorKind, AgentFamily, Employee, Project } from "../data/types";
import { ACCESS_ROLE_LABEL } from "../data/types";

export type Permission =
  | "read"
  | "write"
  | "edit"
  | "delete"
  | "maintain"
  | "approve"
  | "peer_review"
  | "manage_users"
  | "export"
  | "admin_all";

const ROLE_PERMS: Record<AccessRole, Permission[]> = {
  admin: [
    "read",
    "write",
    "edit",
    "delete",
    "maintain",
    "approve",
    "peer_review",
    "manage_users",
    "export",
    "admin_all",
  ],
  /** 核准：可讀、可簽核、可匯出；不可改內文 */
  approver: ["read", "approve", "export"],
  /** 編輯：撰寫維護編輯讀取移除；可覆核他人（非自己）；不可正式簽核 */
  editor: ["read", "write", "edit", "delete", "maintain", "peer_review", "export"],
};

export function roleLabel(role: AccessRole): string {
  return ACCESS_ROLE_LABEL[role];
}

export function hasPermission(user: Employee | null | undefined, perm: Permission): boolean {
  if (!user || user.active === false) return false;
  if (user.accessRole === "admin") return true;
  return ROLE_PERMS[user.accessRole].includes(perm);
}

export function canEditContent(user: Employee | null | undefined): boolean {
  return hasPermission(user, "edit") || hasPermission(user, "write");
}

export function canDelete(user: Employee | null | undefined): boolean {
  return hasPermission(user, "delete");
}

export function canManageUsers(user: Employee | null | undefined): boolean {
  return hasPermission(user, "manage_users");
}

export function canExport(user: Employee | null | undefined): boolean {
  return hasPermission(user, "export");
}

/** 正式簽核（核准並鎖定） */
export function canApproveProject(
  user: Employee | null | undefined,
  project: Project | null | undefined,
): { ok: boolean; reason?: string } {
  if (!user) return { ok: false, reason: "尚未登入" };
  if (!hasPermission(user, "approve")) {
    return { ok: false, reason: "目前角色無簽核權限（需核准人員或管理員）" };
  }
  if (!project) return { ok: true };

  // 編輯不可簽核自己寫的（admin 例外）
  if (user.accessRole !== "admin" && project.authorId === user.id) {
    return { ok: false, reason: "不可核准自己撰寫的文件" };
  }

  // 同一種 Agent 撰寫 → 同 family Agent 不可核准
  if (
    user.kind === "agent" &&
    project.authorAgentFamily &&
    user.agentFamily &&
    project.authorAgentFamily === user.agentFamily
  ) {
    return {
      ok: false,
      reason: `同一種 Agent（${project.authorAgentFamily}）已撰寫此文件，不可再擔任核准角色`,
    };
  }

  return { ok: true };
}

/**
 * 編輯人員覆核：可覆核他人檔案，不可覆核自己的。
 * 管理員永遠可；核准人員不走 peer review（用 approve）。
 */
export function canPeerReview(
  user: Employee | null | undefined,
  project: Project | null | undefined,
): { ok: boolean; reason?: string } {
  if (!user) return { ok: false, reason: "尚未登入" };
  if (user.accessRole === "admin") return { ok: true };
  if (!hasPermission(user, "peer_review")) {
    return { ok: false, reason: "目前角色無覆核權限" };
  }
  if (!project) return { ok: true };
  if (project.authorId === user.id || project.ownerId === user.id) {
    return { ok: false, reason: "編輯人員不可覆核自己的檔案" };
  }
  return { ok: true };
}

export function validateEmployeeRole(kind: ActorKind, role: AccessRole): string | null {
  if (kind === "agent" && role === "admin") {
    return "Agent 僅可設定為編輯或核准角色，不可為管理員";
  }
  return null;
}

export function normalizeAgentFamily(
  kind: ActorKind,
  family: AgentFamily | null | undefined,
): AgentFamily | null {
  if (kind !== "agent") return null;
  return family ?? "other";
}
