import { describe, expect, test } from "bun:test";
import {
  canResolveComment,
  commentsOfProject,
  migrateComments,
  openCommentCount,
  projectOfComment,
} from "../src/lib/comment-scope";
import type { Comment, Employee, Project } from "../src/data/types";

const proj = (id: string, authorId: string): Project =>
  ({
    id,
    title: id,
    status: "draft",
    pct: 0,
    owner: authorId,
    ownerId: authorId,
    authorId,
    mine: true,
    updated: "剛剛",
    tag: "t",
  }) as Project;

const user = (id: string, accessRole: Employee["accessRole"]): Employee =>
  ({
    id,
    name: id,
    title: "",
    avatar: "",
    email: "",
    accessRole,
    kind: "human",
    agentFamily: null,
    password: "",
    active: true,
  }) as Employee;

const comment = (id: string, projectId: string, resolved = false): Comment =>
  ({ id, projectId, author: "a", avatar: "A", time: "", anchor: "", body: "", resolved }) as Comment;

describe("留言的專案歸屬", () => {
  const projects = [proj("pA", "u1"), proj("pB", "u2")];

  test("找得到留言所屬的專案", () => {
    expect(projectOfComment(comment("c1", "pB"), projects)?.id).toBe("pB");
  });

  test("專案不存在時回 null，不退回猜測", () => {
    // 舊版這裡是 `find(p => p.id === "p1") ?? projects[0]` —— 找不到就拿第一個，
    // 於是自審檢查會拿別的專案的作者去比對，靜靜地判錯。
    expect(projectOfComment(comment("c1", "pZ"), projects)).toBeNull();
  });

  test("只取該專案的留言", () => {
    const all = [comment("c1", "pA"), comment("c2", "pB"), comment("c3", "pA")];
    expect(commentsOfProject(all, "pA").map((c) => c.id)).toEqual(["c1", "c3"]);
  });

  test("未解決計數不跨專案", () => {
    const all = [comment("c1", "pA"), comment("c2", "pB"), comment("c3", "pA", true)];
    expect(openCommentCount(all, "pA")).toBe(1);
    expect(openCommentCount(all, "pB")).toBe(1);
  });
});

describe("舊存檔 migration", () => {
  test("缺 projectId 的留言掛到 fallback", () => {
    const legacy = [{ ...comment("c1", ""), projectId: undefined } as unknown as Comment];
    expect(migrateComments(legacy, "pA")[0]!.projectId).toBe("pA");
  });

  test("已經有 projectId 的不被覆蓋", () => {
    expect(migrateComments([comment("c1", "pB")], "pA")[0]!.projectId).toBe("pB");
  });

  test("全部都有時原樣回傳（不重建陣列）", () => {
    const list = [comment("c1", "pA")];
    expect(migrateComments(list, "pX")).toBe(list as unknown as Comment[]);
  });
});

describe("覆核資格", () => {
  const pA = proj("pA", "author1");

  test("管理員永遠可以", () => {
    expect(canResolveComment({ user: user("x", "admin"), project: pA, hasPeerReview: false, hasApprove: false }).ok).toBe(true);
  });

  test("找不到專案就擋下 —— 不猜一個來用", () => {
    const r = canResolveComment({ user: user("x", "editor"), project: null, hasPeerReview: true, hasApprove: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("找不到");
  });

  test("編輯人員不可覆核自己的文件", () => {
    const r = canResolveComment({ user: user("author1", "editor"), project: pA, hasPeerReview: true, hasApprove: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("自己");
  });

  test("編輯人員可覆核他人的文件", () => {
    expect(canResolveComment({ user: user("other", "editor"), project: pA, hasPeerReview: true, hasApprove: false }).ok).toBe(true);
  });

  test("核准人員即使是作者也可以 —— 走的是 approve 不是 peer review", () => {
    // 這條規則刻意與 editor 不同：approver 不能改內文，所以「自己寫的」
    // 情境在實務上不會發生；真要發生時由 canApproveProject 的自審檢查擋。
    expect(canResolveComment({ user: user("author1", "approver"), project: pA, hasPeerReview: false, hasApprove: true }).ok).toBe(true);
  });

  test("兩種資格都沒有就擋下", () => {
    const r = canResolveComment({ user: user("x", "editor"), project: pA, hasPeerReview: false, hasApprove: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("無權覆核");
  });

  test("未登入擋下", () => {
    expect(canResolveComment({ user: null, project: pA, hasPeerReview: true, hasApprove: true }).ok).toBe(false);
  });
});
