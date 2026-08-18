/** 右鍵選單要出現哪些項目。純函式，不碰 DOM / store。 */

export type MenuKind = "item" | "sep";

export type MenuItem = {
  kind: MenuKind;
  id?: string;
  label?: string;
  enabled?: boolean;
};

export type CtxProbe = {
  editable: boolean;
  hasSelection: boolean;
  href: string | null;
  projectId: string | null;
  commitHash: string | null;
  filePath: string | null;
  sectionTitle: string | null;
};

export function itemsFromProbe(p: CtxProbe): MenuItem[] {
  const items: MenuItem[] = [];
  const push = (id: string, label: string, enabled = true) => {
    items.push({ kind: "item", id, label, enabled });
  };
  const sep = () => {
    if (items.length && items[items.length - 1]!.kind !== "sep") items.push({ kind: "sep" });
  };

  if (p.editable) {
    push("cut", "剪下", p.hasSelection);
    push("copy", "複製", p.hasSelection);
    push("paste", "貼上");
    push("select-all", "全選");
  } else if (p.hasSelection) {
    push("copy", "複製");
  }

  if (p.projectId) {
    sep();
    push("proj-dash", "開啟儀表板");
    push("proj-edit", "編輯工作台");
    push("proj-track", "Task Tracking");
    push("proj-hist", "提交與 Diff");
    push("proj-uat", "UAT");
    push("proj-rename", "重新命名");
  }

  if (p.href && !p.href.startsWith("javascript:")) {
    sep();
    push("link-open", "開啟連結");
    push("link-copy", "複製連結");
  }

  if (p.commitHash) {
    sep();
    push("copy-hash", "複製 commit");
  }
  if (p.filePath) {
    sep();
    push("copy-path", "複製路徑");
  }
  if (p.sectionTitle) {
    sep();
    push("copy-section", "複製章節名");
  }

  return items.filter((it, i, arr) => {
    if (it.kind !== "sep") return true;
    return i > 0 && i < arr.length - 1 && arr[i - 1]!.kind !== "sep";
  });
}
