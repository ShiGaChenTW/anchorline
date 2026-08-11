import { store } from "../data/store";
import { projectDisplayName, type Project } from "../data/types";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { buildChangeFiles, CHANGE_KIND_LABEL, normalizeChangeSlug, type ChangeKind, type ChangeFile } from "../lib/change-templates";
import { canQueryStatus, requestOpenspecStatus } from "../lib/status-bridge";
import { nextArtifact, type OpenspecChange, type OpenspecResult } from "../lib/openspec-status";
import { escapeHtml, initMobileNav, toast, updateUserRailFooter } from "../lib/ui";
import { initTheme } from "../lib/theme";

if (requireAuth()) {
  initTheme();
  initMobileNav("openspec");
  bindLogout();
  updateUserRailFooter(toRailUser(store.get().currentUser));

  let selectedProjectId = store.get().activeProjectId ?? "";
  let report: OpenspecResult | null = null;

  function projects(): Project[] {
    const st = store.get();
    return st.projects.filter((p) => st.showSamples || !p.isSample);
  }

  function currentProject(): Project | null {
    return projects().find((p) => p.id === selectedProjectId) ?? projects()[0] ?? null;
  }

  function feedback(text: string, tone: "ok" | "error" = "ok") {
    const el = document.getElementById("os-feedback");
    if (!el) return;
    el.textContent = text;
    el.className = `os-feedback os-feedback--${tone}`;
  }

  function input(): { title: string; slug: string; date: string; kind: ChangeKind } | null {
    const title = (document.getElementById("os-title") as HTMLInputElement | null)?.value.trim() ?? "";
    const rawSlug = (document.getElementById("os-slug") as HTMLInputElement | null)?.value ?? "";
    const kind = ((document.getElementById("os-kind") as HTMLSelectElement | null)?.value ?? "feature") as ChangeKind;
    if (!title) {
      feedback("先填寫變更標題。", "error");
      document.getElementById("os-title")?.focus();
      return null;
    }
    return { title, slug: normalizeChangeSlug(rawSlug || title), date: new Date().toISOString().slice(0, 10), kind };
  }

  function download(file: ChangeFile) {
    const url = URL.createObjectURL(new Blob([file.content], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = file.path.replaceAll("/", "__");
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function filesFromForm(): ChangeFile[] | null {
    const value = input();
    return value ? buildChangeFiles(value.kind, value) : null;
  }

  function renderStatus() {
    const host = document.getElementById("os-status-body");
    if (!host) return;
    const p = currentProject();
    if (!p) {
      host.innerHTML = `<div class="os-empty"><strong>還沒有專案</strong><p>先建立或匯入一個專案，OpenSpec 狀態才有來源。</p></div>`;
      return;
    }
    const root = p.importSummary?.rootPath ?? "";
    const head = `<div class="os-project-line"><strong>${escapeHtml(projectDisplayName(p))}</strong><span>${root ? "已綁定專案資料夾" : "尚未綁定專案資料夾"}</span></div>`;
    if (!root) {
      host.innerHTML = `${head}<div class="os-empty"><strong>尚未連接磁碟上的專案</strong><p>到專案設定綁定資料夾後，這裡會讀取 <code>openspec list --json</code> 與 change 狀態。</p></div>`;
      return;
    }
    if (!report) {
      host.innerHTML = `${head}<div class="os-loading"><span class="os-loading-bar"></span><span>正在讀取 OpenSpec 狀態…</span></div>`;
      return;
    }
    if (!report.available) {
      host.innerHTML = `${head}<div class="os-empty os-empty--warn"><strong>目前讀不到 OpenSpec</strong><p>${escapeHtml(report.reason)}</p><code>bunx openspec init</code></div>`;
      return;
    }
    if (!report.changes.length) {
      host.innerHTML = `${head}<div class="os-empty"><strong>還沒有進行中的 change</strong><p>從上方建立一個新功能文件，或把既有的 <code>openspec/changes/</code> 放進專案。</p></div>`;
      return;
    }
    host.innerHTML = head + `<div class="os-change-list">${report.changes.map(changeCard).join("")}</div>`;
  }

  function changeCard(change: OpenspecChange): string {
    const next = nextArtifact(change);
    const done = change.artifacts.filter((a) => a.status === "done" || a.status === "skipped").length;
    const pct = change.artifacts.length ? Math.round((done / change.artifacts.length) * 100) : 0;
    const artifacts = change.artifacts.map((a) => `<span class="os-artifact os-artifact--${a.status}" title="${escapeHtml(a.outputPath)}">${escapeHtml(a.id)}<b>${a.status}</b></span>`).join("");
    return `<article class="os-change${change.isComplete ? " os-change--complete" : ""}"><div class="os-change-top"><div><span class="os-change-id">${escapeHtml(change.name)}</span><span class="os-change-next">${change.isComplete ? "已完成" : next ? `下一步：${escapeHtml(next.outputPath)}` : "等待前置條件"}</span></div><strong class="os-pct">${pct}%</strong></div><div class="os-progress"><span style="width:${pct}%"></span></div><div class="os-artifacts">${artifacts}</div></article>`;
  }

  async function refresh() {
    const p = currentProject();
    report = null;
    renderStatus();
    if (!p?.importSummary?.rootPath || !canQueryStatus()) {
      report = { available: false, reason: !canQueryStatus() ? "OpenSpec 狀態需要桌面版原生橋。" : "尚未綁定專案資料夾。" };
      renderStatus();
      return;
    }
    report = await requestOpenspecStatus(p.importSummary.rootPath);
    renderStatus();
  }

  document.getElementById("os-download")?.addEventListener("click", () => {
    const files = filesFromForm();
    if (!files) return;
    files.forEach(download);
    feedback(`已下載 ${files.length} 份${CHANGE_KIND_LABEL[((document.getElementById("os-kind") as HTMLSelectElement).value) as ChangeKind]}文件。`, "ok");
    toast("文件已下載，請放回建議的專案路徑");
  });

  document.getElementById("os-copy")?.addEventListener("click", async () => {
    const files = filesFromForm();
    if (!files) return;
    if (!navigator.clipboard) {
      feedback("此環境不支援剪貼簿，請使用下載。", "error");
      return;
    }
    const bundle = files.map((f) => `===== ${f.path} =====\n\n${f.content}`).join("\n\n");
    try {
      await navigator.clipboard.writeText(bundle);
      feedback(`已複製 ${files.length} 份文件，可直接貼給 agent 或存檔。`, "ok");
    } catch {
      feedback("剪貼簿寫入失敗，請改用下載。", "error");
    }
  });

  document.getElementById("os-refresh")?.addEventListener("click", () => void refresh());
  document.getElementById("os-title")?.addEventListener("input", (e) => {
    const slug = document.getElementById("os-slug") as HTMLInputElement | null;
    if (slug && !slug.dataset.edited) slug.value = normalizeChangeSlug((e.target as HTMLInputElement).value);
  });
  document.getElementById("os-slug")?.addEventListener("input", (e) => {
    (e.target as HTMLInputElement).dataset.edited = "1";
  });

  function renderProjectPicker() {
    const p = currentProject();
    const host = document.getElementById("os-status-title");
    if (host && p) host.textContent = `目前專案的 change · ${projectDisplayName(p)}`;
  }

  renderProjectPicker();
  renderStatus();
  void refresh();
  store.subscribe(() => {
    updateUserRailFooter(toRailUser(store.get().currentUser));
    renderProjectPicker();
    renderStatus();
  });
}
