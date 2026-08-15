import { store } from "../data/store";
import type {
  AccessRole,
  ActorKind,
  AgentFamily,
  Employee,
  ProjectStatus,
} from "../data/types";
import { ACCESS_ROLE_LABEL, AGENT_FAMILY_LABEL } from "../data/types";
import { askConfirm, askText } from "../lib/ask";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { initHelpOverlay } from "../lib/help-overlay";
import { canManageUsers } from "../lib/permissions";
import { initTheme } from "../lib/theme";
import { escapeHtml, initMobileNav, toast, updateUserRailFooter } from "../lib/ui";

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
  function renderWorkflow() {
    const list = document.getElementById("workflow-list");
    if (!list) return;
    const stages = [...store.get().workflowStages].sort((a, b) => a.order - b.order);
    const all = store.get().employees.filter((e) => e.active !== false);

    list.innerHTML = stages
      .map((s) => {
        const opts = [
          `<option value="">— 待指派 —</option>`,
          ...all.map(
            (e) =>
              `<option value="${e.id}" ${s.defaultAssigneeId === e.id ? "selected" : ""}>${escapeHtml(e.name)}（${ACCESS_ROLE_LABEL[e.accessRole]}）</option>`,
          ),
        ].join("");
        return `<div class="stage-item" data-id="${s.id}">
          <div class="ord">${String(s.order).padStart(2, "0")}</div>
          <div class="fields">
            <label style="font-size:11px;color:var(--muted)">關卡名稱
              <input class="st-name" value="${escapeHtml(s.name)}" style="width:100%;margin-top:4px;background:var(--bg);border:1px solid var(--border);color:var(--fg);border-radius:6px;padding:6px 8px" />
            </label>
            <label style="font-size:11px;color:var(--muted)">預設簽核人
              <select class="st-assignee" style="width:100%;margin-top:4px;background:var(--bg);border:1px solid var(--border);color:var(--fg);border-radius:6px;padding:6px 8px">${opts}</select>
            </label>
            <label style="font-size:11px;color:var(--muted)">順序
              <select class="st-mode" style="width:100%;margin-top:4px;background:var(--bg);border:1px solid var(--border);color:var(--fg);border-radius:6px;padding:6px 8px"
                      title="串行＝要等前面的關卡結案才輪得到；並行＝隨時可簽">
                <option value="sequential" ${(s.mode ?? "parallel") === "sequential" ? "selected" : ""}>串行（等前面結案）</option>
                <option value="parallel" ${(s.mode ?? "parallel") === "parallel" ? "selected" : ""}>並行（隨時可簽）</option>
              </select>
            </label>
            <label style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px;margin-top:18px"
                   title="非必簽的關卡不擋結案，而且可以被明確略過">
              <input type="checkbox" class="st-req" ${s.required ? "checked" : ""} /> 必簽關卡
            </label>
          </div>
          <div class="actions">
            <button type="button" class="btn btn-sm btn-ghost st-up" title="上移">↑</button>
            <button type="button" class="btn btn-sm btn-ghost st-down" title="下移">↓</button>
            <button type="button" class="btn btn-sm btn-primary st-save">儲存</button>
            <button type="button" class="btn btn-sm btn-ghost st-del">刪除</button>
          </div>
        </div>`;
      })
      .join("");

    list.querySelectorAll(".stage-item").forEach((el) => {
      const id = (el as HTMLElement).dataset.id!;
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
        const name = (el.querySelector(".st-name") as HTMLInputElement).value.trim() || "關卡";
        const defaultAssigneeId =
          (el.querySelector(".st-assignee") as HTMLSelectElement).value || null;
        const required = (el.querySelector(".st-req") as HTMLInputElement).checked;
        const mode = (el.querySelector(".st-mode") as HTMLSelectElement).value as "sequential" | "parallel";
        store.updateWorkflowStage(id, { name, defaultAssigneeId, required, mode });
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
              <span class="mono" style="color:var(--muted)">${s.order}</span>
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
    renderCases();
  }

  render();
  store.subscribe(render);
}
