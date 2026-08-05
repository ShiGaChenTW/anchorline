import { store } from "../data/store";
import type { AgentTaskType, Employee } from "../data/types";
import { ACCESS_ROLE_LABEL, AGENT_FAMILY_LABEL, AGENT_TASK_LABEL } from "../data/types";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { initHelpOverlay } from "../lib/help-overlay";
import { canManageUsers } from "../lib/permissions";
import { initTheme } from "../lib/theme";
import { escapeHtml, initMobileNav, toast, updateUserRailFooter } from "../lib/ui";

const __authed = requireAuth();
if (__authed) {
  initTheme();
  initMobileNav("agents");
  bindLogout();
  initHelpOverlay();

  let selectedId: string | null = null;

  function agents(): Employee[] {
    return store.get().employees.filter((e) => e.kind === "agent");
  }

  function syncUser() {
    const u = store.get().currentUser;
    updateUserRailFooter(toRailUser(u));
  }

  function renderList() {
    const list = document.getElementById("agent-list");
    if (!list) return;
    const items = agents();
    if (!selectedId && items[0]) selectedId = items[0].id;

    list.innerHTML =
      `<h2>Agents（${items.length}）</h2>` +
      items
        .map((a) => {
          const on = a.agentEnabled !== false && a.active !== false;
          return `<button type="button" class="agent-item ${a.id === selectedId ? "active" : ""}" data-id="${a.id}">
            <span class="dot ${on ? "on" : "off"}" title="${on ? "已啟動" : "已關閉"}"></span>
            <div>
              <strong>${escapeHtml(a.name)}</strong>
              <span>${ACCESS_ROLE_LABEL[a.accessRole]} · ${a.agentFamily ? AGENT_FAMILY_LABEL[a.agentFamily] : "—"}</span>
            </div>
          </button>`;
        })
        .join("");

    list.querySelectorAll(".agent-item").forEach((btn) => {
      (btn as HTMLButtonElement).onclick = () => {
        selectedId = (btn as HTMLElement).dataset.id!;
        render();
      };
    });
  }

  function renderDetail() {
    const el = document.getElementById("agent-detail");
    if (!el) return;
    const agent = agents().find((a) => a.id === selectedId);
    if (!agent) {
      el.innerHTML = `<div class="empty-agent">尚無 Agent</div>`;
      return;
    }

    const canEdit = canManageUsers(store.get().currentUser);
    const enabled = agent.agentEnabled !== false;
    const projects = store.get().projects;
    const jobs = store.get().agentJobs.filter((j) => j.agentId === agent.id).slice(0, 12);

    const projectOpts = projects
      .map(
        (p) =>
          `<option value="${p.id}" ${p.id === store.get().activeProjectId ? "selected" : ""}>${escapeHtml(p.title)}</option>`,
      )
      .join("");

    const taskOpts = (Object.keys(AGENT_TASK_LABEL) as AgentTaskType[])
      .filter((t) => {
        if (t === "approve") return agent.accessRole === "approver" || agent.accessRole === "admin";
        if (t === "edit" || t === "coach")
          return agent.accessRole === "editor" || agent.accessRole === "admin";
        return true;
      })
      .map((t) => `<option value="${t}">${AGENT_TASK_LABEL[t]}</option>`)
      .join("");

    el.innerHTML = `
      <h1>${escapeHtml(agent.name)}</h1>
      <div class="sub">${escapeHtml(agent.title)} · ${ACCESS_ROLE_LABEL[agent.accessRole]} · ${
        agent.agentFamily ? AGENT_FAMILY_LABEL[agent.agentFamily] : "—"
      } · <span class="mono">${escapeHtml(agent.email)}</span></div>

      <div class="toolbar-actions">
        <button type="button" class="btn ${enabled ? "btn-ghost" : "btn-primary"}" id="btn-toggle-agent" ${
          canEdit ? "" : "disabled"
        }>
          ${enabled ? "● 關閉 Agent" : "○ 啟動 Agent"}
        </button>
        <span class="pill ${enabled ? "pill-approved" : "pill-draft"}">${enabled ? "執行中可呼叫" : "已關閉"}</span>
        ${!canEdit ? `<span style="font-size:12px;color:var(--muted)">僅管理員可編輯 Agent 設定</span>` : ""}
      </div>

      <div class="invoke-box">
        <h3>呼叫此 Agent 進場作業</h3>
        <div class="agent-grid">
          <label style="font-size:12px;color:var(--muted)">目標專案
            <select id="invoke-project" style="width:100%;margin-top:4px;background:var(--bg);border:1px solid var(--border);color:var(--fg);border-radius:6px;padding:8px">${projectOpts}</select>
          </label>
          <label style="font-size:12px;color:var(--muted)">作業類型
            <select id="invoke-task" style="width:100%;margin-top:4px;background:var(--bg);border:1px solid var(--border);color:var(--fg);border-radius:6px;padding:8px">${taskOpts}</select>
          </label>
        </div>
        <label style="display:block;font-size:12px;color:var(--muted);margin-top:8px">任務說明
          <input id="invoke-note" type="text" placeholder="例如：補強成功指標與威脅模型" style="width:100%;margin-top:4px;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);color:var(--fg);border-radius:6px;padding:8px" />
        </label>
        <div style="margin-top:10px">
          <button type="button" class="btn btn-primary" id="btn-invoke" ${enabled ? "" : "disabled"}>▶ 呼叫進場</button>
        </div>
      </div>

      <div class="field-block">
        <label for="agent-title">顯示職稱 / 角色標題</label>
        <input id="agent-title" type="text" value="${escapeHtml(agent.title)}" ${canEdit ? "" : "readonly"} />
      </div>
      <div class="field-block">
        <label for="agent-role">Role 內容（角色說明）</label>
        <textarea id="agent-role" class="role" ${canEdit ? "" : "readonly"}>${escapeHtml(
          agent.agentRoleBrief || "",
        )}</textarea>
      </div>
      <div class="field-block">
        <label for="agent-prompt">System Prompt</label>
        <textarea id="agent-prompt" ${canEdit ? "" : "readonly"}>${escapeHtml(
          agent.agentPrompt || "",
        )}</textarea>
      </div>
      <div class="toolbar-actions">
        <button type="button" class="btn btn-primary" id="btn-save-agent" ${canEdit ? "" : "disabled"}>儲存 Agent 設定</button>
      </div>

      <h3 style="font-size:13px;margin:8px 0">進場紀錄</h3>
      <div class="jobs" id="job-list">
        ${
          jobs.length
            ? jobs
                .map((j) => {
                  const st =
                    j.status === "done"
                      ? "pill-approved"
                      : j.status === "running" || j.status === "queued"
                        ? "pill-review"
                        : "pill-draft";
                  return `<div class="job-card">
                    <div class="hd">
                      <strong>${AGENT_TASK_LABEL[j.task]} · ${escapeHtml(j.projectTitle)}</strong>
                      <span class="pill ${st}" style="font-size:10px">${j.status}</span>
                    </div>
                    <div style="color:var(--muted)">${escapeHtml(j.note)}</div>
                    ${j.result ? `<div style="margin-top:6px;white-space:pre-wrap">${escapeHtml(j.result)}</div>` : ""}
                    <div class="mono" style="margin-top:4px;color:var(--meta);font-size:10px">${new Date(j.createdAt).toLocaleString("zh-TW")}</div>
                  </div>`;
                })
                .join("")
            : `<div style="color:var(--muted);font-size:12px">尚無進場紀錄</div>`
        }
      </div>
    `;

    document.getElementById("btn-toggle-agent")?.addEventListener("click", () => {
      const r = store.setAgentEnabled(agent.id, !enabled);
      toast(r.ok ? (enabled ? "已關閉 Agent" : "已啟動 Agent") : r.reason ?? "失敗");
      render();
    });

    document.getElementById("btn-save-agent")?.addEventListener("click", () => {
      const title = (document.getElementById("agent-title") as HTMLInputElement).value.trim();
      const agentRoleBrief = (
        document.getElementById("agent-role") as HTMLTextAreaElement
      ).value;
      const agentPrompt = (document.getElementById("agent-prompt") as HTMLTextAreaElement).value;
      const r = store.updateAgentProfile(agent.id, { title, agentRoleBrief, agentPrompt });
      toast(r.ok ? "已儲存 Agent 設定" : r.reason ?? "失敗");
      render();
    });

    document.getElementById("btn-invoke")?.addEventListener("click", () => {
      const projectId = (document.getElementById("invoke-project") as HTMLSelectElement).value;
      const task = (document.getElementById("invoke-task") as HTMLSelectElement)
        .value as AgentTaskType;
      const note = (document.getElementById("invoke-note") as HTMLInputElement).value;
      const r = store.invokeAgent({ agentId: agent.id, projectId, task, note });
      if (!r.ok) {
        toast(r.reason ?? "呼叫失敗");
        return;
      }
      toast(`已呼叫 ${agent.name} 進場（${AGENT_TASK_LABEL[task]}）`);
      // 稍後刷新看結果
      window.setTimeout(() => render(), 500);
      window.setTimeout(() => render(), 1800);
    });
  }

  function render() {
    syncUser();
    renderList();
    renderDetail();
  }

  render();
  store.subscribe(render);
}
