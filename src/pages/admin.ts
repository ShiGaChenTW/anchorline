import { store } from "../data/store";
import type {
  AccessRole,
  ActorKind,
  AgentFamily,
  Employee,
  FullCat,
  ProjectStatus,
  Section,
  WorkflowStageDef,
} from "../data/types";
import { ACCESS_ROLE_LABEL, AGENT_FAMILY_LABEL, FULL_CATS } from "../data/types";
import { askConfirm, askText } from "../lib/ask";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { initHelpOverlay } from "../lib/help-overlay";
import { canManageUsers } from "../lib/permissions";
import { editTargetLabel } from "../lib/submit-assign";
import { initTheme } from "../lib/theme";
import { escapeHtml, initMobileNav, toast, updateUserRailFooter } from "../lib/ui";
import {
  editFieldOptionsHtml,
  FULL_CAT_TITLE,
  landedFlowProjects,
  readStageForm,
  REAPPLY_COPY,
  skeletonLandedCounts,
  SKELETON_D2_NOTICE,
  stageActorLabel,
  stageKindLabel,
  stageModeLabel,
  stagePatchFrom,
  STAGE_FIELD_SEL,
  stageRowFieldsHtml,
} from "../lib/workflow-admin";

const __authed = requireAuth();
if (__authed) {
  initTheme();
  initMobileNav("admin");
  bindLogout();
  initHelpOverlay();
  document.getElementById("btn-logout-2")?.addEventListener("click", () => {
    store.logout();
    location.href = "login.html";
  });

  const STATUS_LABEL: Record<ProjectStatus, string> = {
    draft: "草稿",
    review: "審閱中",
    approved: "已核准",
    withdrawn: "已抽單",
  };

  function syncUser() {
    const u = store.get().currentUser;
    updateUserRailFooter(toRailUser(u));
  }

  function gate() {
    const ok = canManageUsers(store.get().currentUser);
    const denied = document.getElementById("admin-denied");
    const root = document.getElementById("admin-root");
    if (denied) denied.hidden = ok;
    if (root) root.hidden = !ok;
    return ok;
  }

  /* ─── tabs ─── */
  document.querySelectorAll(".admin-tabs [data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = (btn as HTMLElement).dataset.tab!;
      document.querySelectorAll(".admin-tabs [data-tab]").forEach((b) => {
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      document.querySelectorAll(".admin-panel").forEach((p) => {
        p.classList.toggle("active", p.id === `panel-${tab}`);
      });
    });
  });

  /* ─── People ─── */
  function renderPeople() {
    const list = document.getElementById("people-list");
    if (!list) return;
    const { employees, currentUser } = store.get();
    list.innerHTML = employees
      .map((e) => {
        const kind = e.kind === "agent" ? "Agent" : "人員";
        const family =
          e.kind === "agent" && e.agentFamily
            ? AGENT_FAMILY_LABEL[e.agentFamily]
            : "—";
        const roleOpts = (["admin", "approver", "editor"] as AccessRole[])
          .filter((r) => !(e.kind === "agent" && r === "admin"))
          .map(
            (r) =>
              `<option value="${r}" ${e.accessRole === r ? "selected" : ""}>${ACCESS_ROLE_LABEL[r]}</option>`,
          )
          .join("");
        const isCur = e.id === currentUser.id;
        return `<div class="admin-card" data-id="${e.id}">
          <div class="row">
            <div style="display:flex;gap:10px;align-items:center">
              <div class="avatar" style="width:32px;height:32px">${escapeHtml(e.avatar)}</div>
              <div>
                <div style="font-weight:600;color:var(--fg)">
                  ${escapeHtml(e.name)}
                  ${isCur ? '<span class="pill pill-approved" style="font-size:10px;margin-left:6px">目前登入</span>' : ""}
                  <span class="pill" style="font-size:10px;margin-left:4px">${kind}</span>
                  ${e.active === false ? '<span class="pill pill-draft" style="font-size:10px;margin-left:4px">停用</span>' : ""}
                </div>
                <div class="meta">${escapeHtml(e.title)} · <span class="mono">${escapeHtml(e.email)}</span> · 族系 ${escapeHtml(family)}</div>
              </div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${!isCur ? `<button type="button" class="btn btn-sm btn-ghost btn-switch" data-id="${e.id}">切換登入</button>` : ""}
              ${!isCur ? `<button type="button" class="btn btn-sm btn-ghost btn-del" data-id="${e.id}">刪除</button>` : ""}
              <button type="button" class="btn btn-sm btn-ghost btn-toggle-active" data-id="${e.id}">${e.active === false ? "啟用" : "停用"}</button>
            </div>
          </div>
          <div class="admin-form" style="margin-top:12px">
            <label>姓名<input class="edit-name" data-id="${e.id}" value="${escapeHtml(e.name)}" /></label>
            <label>職稱<input class="edit-title" data-id="${e.id}" value="${escapeHtml(e.title)}" /></label>
            <label>Email<input class="edit-email" data-id="${e.id}" value="${escapeHtml(e.email)}" /></label>
            <label>密碼<input class="edit-pass" data-id="${e.id}" value="${escapeHtml(e.password)}" /></label>
            <label>系統角色<select class="edit-role" data-id="${e.id}">${roleOpts}</select></label>
          </div>
          <div style="margin-top:10px">
            <button type="button" class="btn btn-sm btn-primary btn-save-person" data-id="${e.id}">儲存異動</button>
          </div>
        </div>`;
      })
      .join("");

    list.querySelectorAll(".btn-switch").forEach((btn) => {
      (btn as HTMLButtonElement).onclick = () => {
        store.setCurrentUser((btn as HTMLElement).dataset.id!);
        toast(`已切換至 ${store.get().currentUser.name}`);
        render();
      };
    });
    list.querySelectorAll(".btn-del").forEach((btn) => {
      (btn as HTMLButtonElement).onclick = async () => {
        const id = (btn as HTMLElement).dataset.id!;
        const t = employees.find((x) => x.id === id);
        if (!t || !(await askConfirm({ title: `刪除「${t.name}」？`, danger: true }))) return;
        const r = store.deleteEmployee(id);
        toast(r.ok ? "已刪除" : r.reason ?? "失敗");
        render();
      };
    });
    list.querySelectorAll(".btn-toggle-active").forEach((btn) => {
      (btn as HTMLButtonElement).onclick = () => {
        const id = (btn as HTMLElement).dataset.id!;
        const t = employees.find((x) => x.id === id);
        if (!t) return;
        const r = store.updateEmployee(id, { active: t.active === false });
        toast(r.ok ? (t.active === false ? "已啟用" : "已停用") : r.reason ?? "失敗");
        render();
      };
    });
    list.querySelectorAll(".btn-save-person").forEach((btn) => {
      (btn as HTMLButtonElement).onclick = () => {
        const id = (btn as HTMLElement).dataset.id!;
        const card = (btn as HTMLElement).closest(".admin-card")!;
        const name = (card.querySelector(".edit-name") as HTMLInputElement).value.trim();
        const title = (card.querySelector(".edit-title") as HTMLInputElement).value.trim();
        const email = (card.querySelector(".edit-email") as HTMLInputElement).value.trim();
        const password = (card.querySelector(".edit-pass") as HTMLInputElement).value.trim();
        const accessRole = (card.querySelector(".edit-role") as HTMLSelectElement)
          .value as AccessRole;
        const r = store.updateEmployee(id, {
          name,
          title,
          email,
          password: password || "demo",
          accessRole,
          avatar: name.slice(0, 1) || "?",
        });
        toast(r.ok ? "已儲存人員異動" : r.reason ?? "失敗");
        render();
      };
    });
  }

  document.getElementById("p-kind")?.addEventListener("change", () => {
    const kind = (document.getElementById("p-kind") as HTMLSelectElement).value;
    const wrap = document.getElementById("p-family-wrap");
    if (wrap) wrap.style.display = kind === "agent" ? "" : "none";
    const role = document.getElementById("p-role") as HTMLSelectElement;
    if (kind === "agent" && role.value === "admin") role.value = "editor";
  });

  document.getElementById("btn-add-person")?.addEventListener("click", () => {
    const name = (document.getElementById("p-name") as HTMLInputElement).value.trim();
    const title =
      (document.getElementById("p-title") as HTMLInputElement).value.trim() || "成員";
    const email =
      (document.getElementById("p-email") as HTMLInputElement).value.trim() ||
      `${Date.now()}@northwind.io`;
    const password =
      (document.getElementById("p-pass") as HTMLInputElement).value.trim() || "demo";
    const kind = (document.getElementById("p-kind") as HTMLSelectElement).value as ActorKind;
    const accessRole = (document.getElementById("p-role") as HTMLSelectElement)
      .value as AccessRole;
    const agentFamily = (document.getElementById("p-family") as HTMLSelectElement)
      .value as AgentFamily;
    if (!name) {
      toast("請輸入姓名");
      return;
    }
    const emp: Employee = {
      id: `e_${Date.now()}`,
      name,
      title,
      email,
      password,
      kind,
      accessRole,
      agentFamily: kind === "agent" ? agentFamily : null,
      avatar: name.slice(0, 1),
      active: true,
      isCurrent: false,
    };
    const r = store.addEmployee(emp);
    toast(r.ok ? `已新增 ${name}` : r.reason ?? "失敗");
    if (r.ok) {
      (document.getElementById("p-name") as HTMLInputElement).value = "";
      render();
    }
  });

  /* ─── Workflow ─── */

  /**
   * `editTarget` 的章節選項來源。
   *
   * 用目前 active 專案解析出來的章節，不是 `SEED_SECTIONS` —— 領域包會加章節
   * （通用 8 章、payment 12 章），拿種子的話 payment 專屬章節在這裡根本選不到，
   * 而那正是最需要被 `edit` 關卡改寫的幾章。
   *
   * ⚠️ 已知落差：全域關卡與五類骨架都是**跨專案**的，而這份章節清單是
   * 某一個專案的。選了一個別的領域沒有的章節時，落地端會查不到欄位 ——
   * `editTargetLabel` 那時顯示 id 而不是猜一個名字，所以看得出來。列進 UAT。
   */
  function editorSections(): Section[] {
    return store.get().sections;
  }

  function assigneeOptions(stage: WorkflowStageDef, all: Employee[]): string {
    return [
      `<option value="">— 待指派 —</option>`,
      ...all.map(
        (e) =>
          `<option value="${e.id}" ${stage.defaultAssigneeId === e.id ? "selected" : ""}>${escapeHtml(e.name)}（${ACCESS_ROLE_LABEL[e.accessRole]}）</option>`,
      ),
    ].join("");
  }

  /**
   * 一列可編輯的關卡。**全域關卡編輯器與五類骨架編輯器共用。**
   *
   * 兩邊各刻一份的話，之後補欄位一定會漏掉其中一邊，而漏掉的那一邊不會報錯 ——
   * 只會在存檔時把新欄位靜默清成預設值。
   */
  function stageRowHtml(s: WorkflowStageDef, all: Employee[], sections: Section[]): string {
    return `<div class="stage-item" data-id="${escapeHtml(s.id)}">
      <div class="ord">${escapeHtml(String(s.order).padStart(2, "0"))}</div>
      <div class="fields">
        <label class="st-field-label">關卡名稱
          <input class="${STAGE_FIELD_SEL.name.slice(1)}" value="${escapeHtml(s.name)}" />
        </label>
        <label class="st-field-label">預設簽核人
          <select class="${STAGE_FIELD_SEL.assignee.slice(1)}">${assigneeOptions(s, all)}</select>
        </label>
        <label class="st-field-label" title="串行＝要等前面的關卡結案才輪得到；並行＝隨時可簽">順序
          <select class="${STAGE_FIELD_SEL.mode.slice(1)}">
            <option value="sequential" ${(s.mode ?? "parallel") === "sequential" ? "selected" : ""}>串行（等前面結案）</option>
            <option value="parallel" ${(s.mode ?? "parallel") === "parallel" ? "selected" : ""}>並行（隨時可簽）</option>
          </select>
        </label>
        ${stageRowFieldsHtml(s, sections)}
        <label class="st-field-label st-check" title="非必簽的關卡不擋結案，而且可以被明確略過">
          <input type="checkbox" class="${STAGE_FIELD_SEL.required.slice(1)}" ${s.required ? "checked" : ""} /> 必簽關卡
        </label>
      </div>
      <div class="actions">
        <button type="button" class="btn btn-sm btn-ghost st-up" title="上移">↑</button>
        <button type="button" class="btn btn-sm btn-ghost st-down" title="下移">↓</button>
        <button type="button" class="btn btn-sm btn-primary st-save">儲存</button>
        <button type="button" class="btn btn-sm btn-ghost st-del">刪除</button>
      </div>
    </div>`;
  }

  /**
   * 一列的「型態切換」與「章節切換」兩個即時反應。兩邊共用。
   *
   * 不重畫整列是刻意的：重畫會把使用者同一列還沒存的其他修改（關卡名打到一半）
   * 一起丟掉。
   */
  function bindStageRowFields(el: Element) {
    const wraps = Array.from(el.querySelectorAll<HTMLElement>(STAGE_FIELD_SEL.editWrap));
    const kindSel = el.querySelector<HTMLSelectElement>(STAGE_FIELD_SEL.kind);
    kindSel?.addEventListener("change", () => {
      const show = kindSel.value === "edit";
      for (const w of wraps) w.style.display = show ? "" : "none";
    });
    const secSel = el.querySelector<HTMLSelectElement>(STAGE_FIELD_SEL.editSection);
    const fieldSel = el.querySelector<HTMLSelectElement>(STAGE_FIELD_SEL.editField);
    secSel?.addEventListener("change", () => {
      // 換了章節，舊的 fieldKey 一定不屬於新章節 —— 不重建選項的話，
      // 下拉會留著上一章的欄位名，而存下去是一個查不到的位址
      if (fieldSel) fieldSel.innerHTML = editFieldOptionsHtml(editorSections(), secSel.value, "");
    });
  }

  function renderWorkflow() {
    const list = document.getElementById("workflow-list");
    if (!list) return;
    const stages = [...store.get().workflowStages].sort((a, b) => a.order - b.order);
    const all = store.get().employees.filter((e) => e.active !== false);
    const sections = editorSections();

    list.innerHTML = stages.map((s) => stageRowHtml(s, all, sections)).join("");

    list.querySelectorAll(".stage-item").forEach((el) => {
      const id = (el as HTMLElement).dataset.id!;
      bindStageRowFields(el);
      el.querySelector(".st-up")?.addEventListener("click", () => {
        store.moveWorkflowStage(id, -1);
        renderWorkflow();
      });
      el.querySelector(".st-down")?.addEventListener("click", () => {
        store.moveWorkflowStage(id, 1);
        renderWorkflow();
      });
      el.querySelector(".st-del")?.addEventListener("click", async () => {
        if (!(await askConfirm({ title: "刪除此關卡？", danger: true }))) return;
        store.removeWorkflowStage(id);
        toast("已刪除關卡");
        renderWorkflow();
      });
      el.querySelector(".st-save")?.addEventListener("click", () => {
        // `kind` / `defaultActor` / `editTarget` 就是在這一行交出去的。
        // Wave 1 加好了欄位、`updateWorkflowStage` 也收得下，但這裡一直只傳四個 ——
        // 於是使用者可以在管理中心建一個「會改 PRD 內文」的關卡，而畫面上跟
        // 只出意見的關卡長得一模一樣。讀回走共用的 `readStageForm`+`stagePatchFrom`，
        // 測試才驗得到這一行到底有沒有把東西交出去（Wave 1 F0 的教訓）
        store.updateWorkflowStage(id, stagePatchFrom(readStageForm(el)));
        toast("已更新關卡");
        renderWorkflow();
      });
    });
  }

  document.getElementById("btn-add-stage")?.addEventListener("click", () => {
    store.addWorkflowStage({ name: `關卡 ${store.get().workflowStages.length + 1}` });
    toast("已新增關卡");
    renderWorkflow();
  });

  /* ─── C-2：五類 PRD 範本的簽核骨架 ─── */

  /**
   * 哪幾類是展開的。`store.subscribe(render)` 會把整頁重畫，不記著的話
   * 使用者每存一次關卡，他正在看的那一類就自己收合起來。
   */
  const openSkeletons = new Set<FullCat>();

  /** 這一類目前的骨架（覆寫優先）。畫面與送審讀的是**同一支** */
  function skeletonOf(cat: FullCat): WorkflowStageDef[] {
    return [...store.workflowSkeletons()[cat]].sort((a, b) => a.order - b.order);
  }

  /** 存一份改好的骨架回去，失敗就把 store 的拒絕理由原樣說出來 */
  function saveSkeleton(cat: FullCat, stages: WorkflowStageDef[], okMsg: string) {
    const r = store.setWorkflowSkeleton(cat, stages);
    toast(r.ok ? okMsg : (r.reason ?? "失敗"));
    renderSkeletons();
  }

  function renderSkeletons() {
    const host = document.getElementById("skeleton-list");
    if (!host) return;
    const all = store.get().employees.filter((e) => e.active !== false);
    const sections = editorSections();
    const counts = skeletonLandedCounts(store.get().projects);
    const overrides = store.get().workflowSkeletons ?? {};

    host.innerHTML = FULL_CATS.map((cat) => {
      const stages = skeletonOf(cat);
      const customized = Boolean(overrides[cat]?.length);
      return `<details class="skeleton-block" data-cat="${cat}" ${openSkeletons.has(cat) ? "open" : ""}>
        <summary>
          <span class="sk-title">${escapeHtml(FULL_CAT_TITLE[cat])}</span>
          <span class="pill" style="font-size:10px">${stages.length} 關</span>
          ${customized ? '<span class="pill pill-review" style="font-size:10px">已自訂</span>' : ""}
          <span class="sk-count">目前有 ${counts[cat]} 個專案落地了這一份</span>
        </summary>
        <p class="sk-notice">${escapeHtml(SKELETON_D2_NOTICE)}</p>
        <div class="stage-list">
          ${stages.map((s) => stageRowHtml(s, all, sections)).join("")}
        </div>
        <div class="sk-actions">
          <button type="button" class="btn btn-sm btn-primary sk-add">＋ 新增關卡</button>
          <button type="button" class="btn btn-sm btn-ghost sk-reset" ${customized ? "" : "disabled"}>還原成預設</button>
        </div>
      </details>`;
    }).join("");

    host.querySelectorAll<HTMLDetailsElement>(".skeleton-block").forEach((block) => {
      const cat = block.dataset.cat as FullCat;
      block.addEventListener("toggle", () => {
        if (block.open) openSkeletons.add(cat);
        else openSkeletons.delete(cat);
      });

      block.querySelector(".sk-add")?.addEventListener("click", () => {
        // 新關卡一律 review + agent：預設成 edit 等於讓使用者點兩下就多出一個
        // 會改 PRD 內文的關卡，而畫面上跟 review 關卡長得一樣。與
        // `store.addWorkflowStage` 的預設逐字一致
        const cur = skeletonOf(cat);
        const next: WorkflowStageDef[] = [
          ...cur,
          {
            id: `wsk-${cat}-${Date.now()}`,
            order: cur.length + 1,
            name: `關卡 ${cur.length + 1}`,
            defaultAssigneeId: null,
            required: true,
            mode: "sequential",
            kind: "review",
            defaultActor: "agent",
          },
        ];
        saveSkeleton(cat, next, "已新增關卡");
      });

      block.querySelector(".sk-reset")?.addEventListener("click", async () => {
        if (
          !(await askConfirm({
            title: `把「${FULL_CAT_TITLE[cat]}」的骨架還原成預設？`,
            body: "這一類的自訂關卡會全部消失。已經落地的專案不受影響。",
            danger: true,
          }))
        ) {
          return;
        }
        store.resetWorkflowSkeleton(cat);
        toast("已還原成預設骨架");
        renderSkeletons();
      });

      block.querySelectorAll(".stage-item").forEach((el) => {
        const id = (el as HTMLElement).dataset.id!;
        bindStageRowFields(el);
        el.querySelector(".st-save")?.addEventListener("click", () => {
          const patch = stagePatchFrom(readStageForm(el));
          saveSkeleton(
            cat,
            skeletonOf(cat).map((s) => (s.id === id ? { ...s, ...patch } : s)),
            "已更新骨架關卡",
          );
        });
        el.querySelector(".st-del")?.addEventListener("click", async () => {
          if (!(await askConfirm({ title: "從這一類骨架刪除此關卡？", danger: true }))) return;
          // 刪到只剩零關、或把「我核准」刪掉，都會被 store 擋下來並說明原因 ——
          // UI 這裡刻意不自己先擋一次：兩份規則會分岔，而分岔的那一天，
          // 畫面上按得下去的東西 store 會拒絕，看起來像存檔壞了
          saveSkeleton(
            cat,
            skeletonOf(cat).filter((s) => s.id !== id),
            "已刪除骨架關卡",
          );
        });
        const move = (dir: -1 | 1) => {
          const cur = skeletonOf(cat);
          const i = cur.findIndex((s) => s.id === id);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= cur.length) return;
          [cur[i], cur[j]] = [cur[j]!, cur[i]!];
          saveSkeleton(cat, cur, "已調整順序");
        };
        el.querySelector(".st-up")?.addEventListener("click", () => move(-1));
        el.querySelector(".st-down")?.addEventListener("click", () => move(1));
      });
    });
  }

  /* ─── C-3：各專案已落地的流程（唯讀）─── */

  const openFlows = new Set<string>();

  /**
   * 這顆鈕對這個案子到底有沒有效。
   *
   * **一律問 `store.submitPlan()`，不要在這裡重寫一份 `caseHasRun`。**
   * 那正是 W2-A 把判斷抽進 `submitPlan` 要防的分岔 —— 而分岔的症狀就是這一整段
   * 在修的東西：畫面說的跟實際發生的不是同一件事。
   */
  function reapplyEffective(projectId: string): boolean {
    return store.submitPlan(projectId).landsNow;
  }

  /**
   * 「重新套用範本」那一塊。**兩種案子現在都按得到**，因為兩邊都真的會發生事情；
   * 差別在後果的嚴重度，所以鈕的字樣、旁邊的說明、對話框與 toast 全部分兩套。
   *
   * 跑過的案子為什麼不再停用：`reapplyWorkflow` 已經連個案一起重建（Scott 拍板），
   * 那顆鈕對它真的生效了。停用是上一輪的誠實做法，現在它自己變成了那句假話。
   *
   * 破壞性的那條**在鈕上就要看得出後果**（不是等對話框才講）——
   * 管理員按之前就該知道自己要失去什麼。
   */
  function reapplyBlockHtml(projectId: string): string {
    if (!reapplyEffective(projectId)) {
      return `<p class="lf-note">${escapeHtml(REAPPLY_COPY.ranWarn)}</p>
        <div class="sk-actions">
          <button type="button" class="btn btn-sm btn-ghost lf-reapply" style="color:var(--danger)">${escapeHtml(REAPPLY_COPY.ranButton)}</button>
        </div>`;
    }
    return `<div class="sk-actions">
      <button type="button" class="btn btn-sm btn-ghost lf-reapply" style="color:var(--danger)">${escapeHtml(REAPPLY_COPY.freshButton)}</button>
    </div>`;
  }

  function renderLandedFlows() {
    const host = document.getElementById("landed-flow-list");
    if (!host) return;
    const { projects, cases, currentUser } = store.get();
    const landed = landedFlowProjects(projects);
    const isAdmin = currentUser.accessRole === "admin";

    if (!landed.length) {
      host.innerHTML =
        '<div class="admin-card" style="color:var(--muted);font-size:var(--fs-2)">還沒有任何專案落地流程 —— 專案第一次送出審閱時才會落地。</div>';
      return;
    }

    host.innerHTML = landed
      .map((p) => {
        const sections = store.sectionsFor(p.id);
        const c = cases[p.id];
        const rows = [...(p.workflowStages ?? [])]
          .sort((a, b) => a.order - b.order)
          .map((s) => {
            const tags = [`<span class="pill" style="font-size:10px">${escapeHtml(stageKindLabel(s.kind))}</span>`];
            if (s.required === false) tags.push('<span class="pill pill-draft" style="font-size:10px">非必簽</span>');
            const warn =
              s.kind === "edit"
                ? `<span class="lf-warn">存檔覆寫「${escapeHtml(editTargetLabel(s.editTarget, sections))}」</span>`
                : "";
            return `<div class="lf-row">
              <span class="mono" style="color:var(--muted)">${escapeHtml(String(s.order).padStart(2, "0"))}</span>
              <span class="lf-name">${escapeHtml(s.name)}</span>
              ${tags.join("")}
              <span class="lf-sub">${escapeHtml(stageActorLabel(s.defaultActor))}／${escapeHtml(stageModeLabel(s.mode))}</span>
              ${warn}
            </div>`;
          })
          .join("");
        const state = c?.locked ? "已鎖定" : c?.withdrawn || p.status === "withdrawn" ? "已抽單" : STATUS_LABEL[p.status];
        return `<details class="admin-card lf-block" data-pid="${escapeHtml(p.id)}" ${openFlows.has(p.id) ? "open" : ""}>
          <summary>
            <span style="font-weight:600;color:var(--fg)">${escapeHtml(p.title)}</span>
            <span class="pill" style="font-size:10px">${escapeHtml(state)}</span>
            <span class="lf-sub">${(p.workflowStages ?? []).length} 關</span>
          </summary>
          <div class="lf-rows">${rows}</div>
          ${isAdmin ? reapplyBlockHtml(p.id) : ""}
        </details>`;
      })
      .join("");

    host.querySelectorAll<HTMLDetailsElement>(".lf-block").forEach((block) => {
      const pid = block.dataset.pid!;
      block.addEventListener("toggle", () => {
        if (block.open) openFlows.add(pid);
        else openFlows.delete(pid);
      });
      block.querySelector(".lf-reapply")?.addEventListener("click", async () => {
        // 再問一次「**現在**」的狀態，不是畫這顆鈕的那一次：畫面可能是上一次
        // render 留下的，而這個案子在那之後跑過了 —— 那時該跳的是破壞性那份
        // 對話框，而不是「不會弄丟東西」那份。兩種後果的嚴重度不同，
        // 對話框與 toast 都跟著這一次的答案走
        const copy = reapplyEffective(pid)
          ? { title: REAPPLY_COPY.freshTitle, body: REAPPLY_COPY.freshBody, done: REAPPLY_COPY.okToast }
          : { title: REAPPLY_COPY.ranTitle, body: REAPPLY_COPY.ranBody, done: REAPPLY_COPY.ranOkToast };
        const ok = await askConfirm({ title: copy.title, body: copy.body, danger: true });
        if (!ok) return;
        const r = store.reapplyWorkflow(pid);
        toast(r.ok ? copy.done : (r.reason ?? "失敗"));
        renderLandedFlows();
      });
    });
  }

  /* ─── Cases ─── */
  function renderCases() {
    const list = document.getElementById("cases-list");
    if (!list) return;
    const { projects, cases, employees, activeProjectId } = store.get();
    const all = employees.filter((e) => e.active !== false);

    // focus review/approved/withdrawn first
    const sorted = [...projects].sort((a, b) => {
      const rank = (s: ProjectStatus) =>
        s === "review" ? 0 : s === "withdrawn" ? 1 : s === "approved" ? 2 : 3;
      return rank(a.status) - rank(b.status);
    });

    list.innerHTML = sorted
      .map((p) => {
        const c = cases[p.id];
        const stages = c?.stages ?? [];
        const withdrawn = c?.withdrawn || p.status === "withdrawn";
        const stageRows = stages
          .map((s) => {
            const opts = [
              `<option value="">— 待指派 —</option>`,
              ...all.map(
                (e) =>
                  `<option value="${e.id}" ${s.assigneeId === e.id ? "selected" : ""}>${escapeHtml(e.name)}</option>`,
              ),
            ].join("");
            const st =
              s.state === "approved"
                ? "pill-approved"
                : s.state === "pending"
                  ? "pill-review"
                  : "pill-draft";
            return `<div class="case-stage-row">
              <span class="mono" style="color:var(--muted)">${escapeHtml(String(s.order))}</span>
              <span>${escapeHtml(s.name)}</span>
              <select class="case-reassign" data-pid="${p.id}" data-sid="${s.id}" ${withdrawn || c?.locked ? "disabled" : ""} style="background:var(--bg);border:1px solid var(--border);color:var(--fg);border-radius:6px;padding:4px 8px;font-size:12px">${opts}</select>
              <span class="pill ${st}" style="font-size:10px">${s.state}</span>
            </div>`;
          })
          .join("");

        return `<div class="admin-card" data-pid="${p.id}">
          <div class="row">
            <div>
              <div style="font-weight:600;color:var(--fg)">
                ${escapeHtml(p.title)}
                ${p.id === activeProjectId ? '<span class="pill pill-review" style="font-size:10px;margin-left:6px">目前審閱</span>' : ""}
              </div>
              <div class="meta">
                #${escapeHtml(p.tag)} · 擁有者 ${escapeHtml(p.owner)} ·
                <span class="pill ${p.status === "approved" ? "pill-approved" : p.status === "review" ? "pill-review" : "pill-draft"}" style="font-size:10px">${STATUS_LABEL[p.status]}</span>
                ${withdrawn && c?.withdrawReason ? ` · 抽單原因：${escapeHtml(c.withdrawReason)}` : ""}
                ${c?.locked ? " · 已鎖定" : ""}
              </div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button type="button" class="btn btn-sm btn-ghost btn-focus" data-id="${p.id}">設為審閱焦點</button>
              <button type="button" class="btn btn-sm btn-ghost btn-apply-flow" data-id="${p.id}">套用目前流程</button>
              ${
                withdrawn
                  ? `<button type="button" class="btn btn-sm btn-primary btn-reopen" data-id="${p.id}">重開案件</button>`
                  : `<button type="button" class="btn btn-sm btn-ghost btn-withdraw" data-id="${p.id}" style="color:var(--danger)">抽單</button>`
              }
              <a class="btn btn-sm" href="review.html">開審閱頁</a>
            </div>
          </div>
          <div class="case-stages">
            ${stageRows || '<div style="font-size:12px;color:var(--muted)">尚無關卡 — 請「套用目前流程」</div>'}
          </div>
        </div>`;
      })
      .join("");

    list.querySelectorAll(".btn-focus").forEach((btn) => {
      (btn as HTMLButtonElement).onclick = () => {
        store.setActiveProject((btn as HTMLElement).dataset.id!);
        toast("已設定審閱焦點專案");
        renderCases();
      };
    });
    list.querySelectorAll(".btn-apply-flow").forEach((btn) => {
      (btn as HTMLButtonElement).onclick = async () => {
        const id = (btn as HTMLElement).dataset.id!;
        if (!(await askConfirm({ title: "以目前簽核流程覆寫此個案關卡？（會重置簽核狀態）", danger: true }))) return;
        const r = store.applyWorkflowToCase(id);
        toast(r.ok ? "已套用流程" : r.reason ?? "失敗");
        renderCases();
      };
    });
    list.querySelectorAll(".btn-withdraw").forEach((btn) => {
      (btn as HTMLButtonElement).onclick = async () => {
        const id = (btn as HTMLElement).dataset.id!;
        // `?? ""` 會把 prompt 的 null 吃掉，讓下一行的守衛變成死分支——桌面殼裡
        // prompt() 恆回 null（wry 的 WKWebView delegate 缺口），於是「取消」與
        // 「對話框根本沒出現」都會直接抽單、理由被 store 補成預設值。留 null 給守衛擋。
        const reason = await askText({ title: "抽單原因", value: "需求變更／管理者抽單" });
        if (reason === null) return;
        const r = store.withdrawCase(id, reason);
        toast(r.ok ? "已抽單" : r.reason ?? "失敗");
        renderCases();
      };
    });
    list.querySelectorAll(".btn-reopen").forEach((btn) => {
      (btn as HTMLButtonElement).onclick = () => {
        const id = (btn as HTMLElement).dataset.id!;
        const r = store.reopenCase(id);
        toast(r.ok ? "已重開並套用流程" : r.reason ?? "失敗");
        renderCases();
      };
    });
    list.querySelectorAll(".case-reassign").forEach((sel) => {
      (sel as HTMLSelectElement).onchange = () => {
        const pid = (sel as HTMLElement).dataset.pid!;
        const sid = (sel as HTMLElement).dataset.sid!;
        const val = (sel as HTMLSelectElement).value || null;
        const r = store.reassignCaseStage(pid, sid, val);
        toast(r.ok ? "已異動關卡人員" : r.reason ?? "失敗");
        renderCases();
      };
    });
  }

  function render() {
    syncUser();
    if (!gate()) return;
    renderPeople();
    renderWorkflow();
    renderSkeletons();
    renderLandedFlows();
    renderCases();
  }

  render();
  store.subscribe(render);
}
