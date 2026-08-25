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

/** 側欄／個人資訊用：精簡能力標籤（中文 chips） */
export function summarizePermissions(user: Employee | null | undefined): string[] {
  if (!user || user.active === false) return ["未啟用"];
  if (user.accessRole === "admin") return ["全部權限"];
  const chips: string[] = [];
  if (hasPermission(user, "edit") || hasPermission(user, "write")) chips.push("編輯");
  if (hasPermission(user, "delete")) chips.push("刪除");
  if (hasPermission(user, "approve")) chips.push("簽核");
  if (hasPermission(user, "peer_review")) chips.push("覆核");
  if (hasPermission(user, "export")) chips.push("匯出");
  if (hasPermission(user, "manage_users")) chips.push("帳號");
  if (chips.length === 0) chips.push("唯讀");
  return chips;
}

/** 角色 badge 視覺調性 class */
export function accessRoleTone(role: AccessRole): string {
  if (role === "admin") return "role-tone-admin";
  if (role === "approver") return "role-tone-approver";
  return "role-tone-editor";
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

/**
 * 簽核能力（角色層級）。**這不是「能不能簽這一關」**。
 *
 * 這個檔只回答「這個角色有沒有簽核這件能力」；職責分立（不可自審、同族系
 * agent 不可核准）與關卡歸屬全部收在 `lib/signoff.ts` 的 `canSignStage`，
 * 那裡是簽核權限的唯一入口。
 *
 * 原本這裡有一支 `canApproveProject` 同時扛兩件事，於是
 * `permissions.canApproveProject` → `signoff.canSignStage` → `store.approveAndLock`
 * 三處各判一次，而三份判斷已經開始分岔。要判「能不能簽」請呼叫 `canSignStage`。
 */
export function canApprove(user: Employee | null | undefined): boolean {
  return hasPermission(user, "approve");
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
