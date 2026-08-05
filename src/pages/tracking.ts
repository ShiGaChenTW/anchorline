import { store } from "../data/store";
import { bindLogout, requireAuth, roleBadge } from "../lib/auth";
import { deriveFlowLayers } from "../lib/flow-layers";
import { initHelpOverlay } from "../lib/help-overlay";
import { evaluatePrdGates, gateSummaryLine } from "../lib/prd-gates";
import { parsePlanMeta, planProgressPct, type PlanMeta } from "../lib/plan-parser";
import { initTheme } from "../lib/theme";
import { escapeHtml, initMobileNav, toast, updateUserRailFooter } from "../lib/ui";

/** Vite 編譯期嵌入 plans/*.md */
const planFiles = import.meta.glob("../../plans/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

type PlanEntry = { id: string; name: string; raw: string; meta: PlanMeta };

const __authed = requireAuth();
if (__authed) {
  initTheme();
  initMobileNav("admin");
  bindLogout();
  initHelpOverlay();

  let plans: PlanEntry[] = [];
  let idx = 0;

  function loadPlans() {
    plans = Object.entries(planFiles)
      .map(([path, raw]) => {
        const name = path.split("/").pop() ?? path;
        const meta = parsePlanMeta(raw, name);
        return { id: name, name, raw, meta };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
    if (idx >= plans.length) idx = 0;
  }

  function syncUser() {
    const u = store.get().currentUser;
    updateUserRailFooter({
      name: u.name,
      role: `${roleBadge(u.accessRole)} · ${u.title}`,
      avatar: u.avatar,
    });
  }

  function renderList() {
    const el = document.getElementById("plan-list");
    if (!el) return;
    if (!plans.length) {
      el.innerHTML = `<div style="padding:16px;color:var(--muted)">plans/ 尚無計劃檔</div>`;
      return;
    }
    el.innerHTML = plans
      .map((p, i) => {
        const pct = planProgressPct(p.meta);
        return `<button type="button" class="tui-plan-item ${i === idx ? "active" : ""}" data-i="${i}">
          <div class="t">${escapeHtml(p.meta.title)}</div>
          <div class="m">${escapeHtml(p.meta.status)} · ${p.meta.done_steps}/${p.meta.total_steps} · ${pct}%</div>
        </button>`;
      })
      .join("");
    el.querySelectorAll(".tui-plan-item").forEach((btn) => {
      (btn as HTMLButtonElement).onclick = () => {
        idx = Number((btn as HTMLElement).dataset.i);
        render();
      };
    });
  }

  function renderMain() {
    const p = plans[idx];
    const hd = document.getElementById("plan-hd");
    const sum = document.getElementById("plan-summary");
    const steps = document.getElementById("step-list");
    if (!p) {
      if (hd) hd.textContent = "步驟";
      if (sum) sum.innerHTML = "";
      if (steps) steps.innerHTML = `<div style="padding:20px;color:var(--muted)">無計劃</div>`;
      return;
    }
    const pct = planProgressPct(p.meta);
    if (hd) hd.textContent = `步驟 · ${p.name}`;
    if (sum) {
      sum.innerHTML = `
        <div style="font-weight:600;font-size:14px;color:var(--fg);font-family:var(--font-body)">${escapeHtml(p.meta.title)}</div>
        <div style="color:var(--muted);margin-top:4px">${escapeHtml(p.meta.status)} · 建立 ${escapeHtml(p.meta.created)} · 更新 ${escapeHtml(p.meta.updated)}</div>
        <div class="tui-bar"><i style="width:${pct}%"></i></div>
        <div style="color:var(--muted)">${p.meta.done_steps} done · ${p.meta.pending_steps} pending · ${p.meta.skipped_steps} skipped · ${pct}%</div>
        <div style="margin-top:8px;color:var(--fg-2)">下一步：<strong style="color:var(--accent)">${escapeHtml(p.meta.next_step)}</strong></div>
      `;
    }
    if (steps) {
      if (!p.meta.steps.length) {
        steps.innerHTML = `<div style="padding:16px;color:var(--muted)">此檔無 Plan Steps checkbox</div>`;
      } else {
        steps.innerHTML = p.meta.steps
          .map((s) => {
            const mark = s.state === "done" ? "✔" : s.state === "skipped" ? "—" : "○";
            return `<div class="tui-step ${s.state}"><span class="mark">${mark}</span><span>${escapeHtml(s.text)}</span></div>`;
          })
          .join("");
      }
    }
  }

  function renderGates() {
    const el = document.getElementById("gate-panel");
    if (!el) return;
    const report = evaluatePrdGates(store.get());
    const foot = document.getElementById("tui-footer");
    if (foot) {
      foot.textContent = `${gateSummaryLine(report)} · j/k 切計劃 · r 重新整理 · score ${report.score}`;
    }
    el.innerHTML =
      `<div style="margin-bottom:8px;color:var(--fg)">score <strong>${report.score}</strong> · block ${report.blocks} · warn ${report.warns}</div>` +
      report.findings
        .map((f) => {
          const cls =
            f.level === "block" ? "pill-draft" : f.level === "warn" ? "pill-review" : "pill-approved";
          const label = f.level === "block" ? "BLOCK" : f.level === "warn" ? "WARN" : "PASS";
          return `<div class="gate-item">
            <span class="pill ${cls} lv">${label}</span>
            <div><div style="color:var(--fg)">${escapeHtml(f.label)}</div>
            <div style="color:var(--muted);margin-top:2px">${escapeHtml(f.detail)}</div></div>
          </div>`;
        })
        .join("");
  }

  function renderLayers() {
    const el = document.getElementById("layer-panel");
    if (!el) return;
    const hasPlan = plans.some((p) => p.meta.total_steps > 0);
    const layers = deriveFlowLayers(store.get(), { hasPlanSteps: hasPlan });
    el.innerHTML = layers
      .map((l) => {
        const mark = l.done ? "●" : l.active ? "▶" : "○";
        const color = l.done ? "var(--success)" : l.active ? "var(--accent)" : "var(--meta)";
        return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-muted)" title="${escapeHtml(l.hint)}">
        <span>${l.code} ${l.name}</span>
        <span style="color:${color}">${mark}</span>
      </div>`;
      })
      .join("");

    const p = plans[idx];
    if (p) {
      el.innerHTML += `
        <div class="tui-meta-card" style="margin:12px 0 0">
          <div class="k">目標</div>
          <div class="v">${escapeHtml(p.meta.goal)}</div>
        </div>
        <div class="tui-meta-card">
          <div class="k">最近決策</div>
          <div class="v">${escapeHtml(p.meta.last_decision)}</div>
        </div>
        <div class="tui-meta-card">
          <div class="k">阻塞</div>
          <div class="v">${p.meta.blockers} 項</div>
        </div>`;
    }
  }

  function render() {
    syncUser();
    renderList();
    renderMain();
    renderGates();
    renderLayers();
  }

  document.getElementById("btn-refresh")?.addEventListener("click", () => {
    loadPlans();
    render();
    toast("已重新解析 plans/");
  });

  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (t.matches("input, textarea, select")) return;
    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      idx = Math.min(plans.length - 1, idx + 1);
      render();
    }
    if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      idx = Math.max(0, idx - 1);
      render();
    }
    if (e.key === "r") {
      e.preventDefault();
      loadPlans();
      render();
      toast("重新整理");
    }
    if (e.key === "?") {
      e.preventDefault();
      toast("j/k 切計劃 · r 重新整理 · 右欄為 PRD 結構 gate（送審阻擋用）");
    }
  });

  loadPlans();
  render();
  store.subscribe(render);
}
