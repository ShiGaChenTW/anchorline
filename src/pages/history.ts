/**
 * 提交與 Diff —— 人眼看 git 歷史，不從這裡改 repo。
 *
 * Changes = 工作區未提交；History = 已載入的 commit。
 * 註解只活在本機 localStorage。
 */
import { store } from "../data/store";
import { projectDisplayName, type Project } from "../data/types";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { parsePorcelain } from "../lib/commit-message";
import { initHelpOverlay } from "../lib/help-overlay";
import { beginBootOverlay, endBootOverlay, failBootOverlay } from "../lib/loading-overlay";
import { renderMarkdown } from "../lib/markamd/markdown";
import { isUnavailable, native } from "../lib/native";
import {
  extractFilePatch,
  loadNote,
  renderPatch,
  saveNote,
  type CommitFile,
} from "../lib/patch-view";
import { relativeTime } from "../lib/file-history";
import { requestProjectStats, type GitStats } from "../lib/project-stats";
import { syncRailContext } from "../lib/rail-projects";
import { initTheme } from "../lib/theme";
import { escapeHtml, initMobileNav, toast, updateUserRailFooter } from "../lib/ui";

type Tab = "changes" | "history";
type Mode = "unified" | "split";

type LoadedCommit = {
  hash: string;
  subject: string;
  body: string;
  author: string;
  email: string;
  at: string;
  files: CommitFile[];
  patch: string;
  truncated: boolean;
};

// 第一行：攔截要先裝好才擋得住後面任何一行的 throw（見 loading-overlay.ts）
beginBootOverlay({ autoHideAfter: 8000 });

if (!requireAuth()) {
  /* redirected —— 刻意不收遮罩，收了只會讓使用者看到一頁馬上要離開的空殼 */
} else {
  initTheme();
  initMobileNav("history");
  bindLogout();
  initHelpOverlay();
  boot()
    .catch((err) => failBootOverlay(err))
    .finally(() => endBootOverlay());
}

async function boot(): Promise<void> {
  const listEl = document.getElementById("commit-list")!;
  const headEl = document.getElementById("commit-head")!;
  const filesEl = document.getElementById("file-list")!;
  const diffEl = document.getElementById("diff-view")!;
  const filterEl = document.getElementById("commit-filter") as HTMLInputElement;
  const noteEl = document.getElementById("note-text") as HTMLTextAreaElement;
  const previewEl = document.getElementById("note-preview-pane")!;

  let tab: Tab = "history";
  let mode: Mode = "unified";
  let noteMode: "write" | "preview" = "write";
  let stats: GitStats | null = null;
  let working: { files: CommitFile[]; patch: string; truncated: boolean; status: string } | null =
    null;
  let detail: LoadedCommit | null = null;
  let selectedHash = "";
  let selectedPath = "";
  let filter = "";
  let busy = false;

  function project(): Project | null {
    const st = store.get();
    const visible = st.projects.filter((p) => (st.showSamples ? true : !p.isSample));
    return visible.find((p) => p.id === st.activeProjectId) ?? visible[0] ?? null;
  }

  function rootOf(p: Project | null): string {
    return p?.importSummary?.rootPath ?? "";
  }

  function syncChrome(p: Project | null): void {
    updateUserRailFooter(toRailUser(store.get().currentUser));
    const name = p ? projectDisplayName(p) : "未選擇專案";
    const title = document.getElementById("page-title");
    if (title) title.textContent = name;
    const sub = document.getElementById("page-sub");
    if (sub) {
      sub.textContent = stats
        ? `${stats.branch} · ${stats.commitCount} commits`
        : "看這個專案實際發生過什麼。不從這裡 commit 或 push。";
    }
    const path = document.getElementById("page-path");
    if (path) path.textContent = p?.sourceFolder ? `${p.sourceFolder} / history` : "project / history";
    syncRailContext({
      mode: "提交與 Diff",
      projectName: name,
      statusLabel: stats?.branch || "",
      statusTone: stats?.dirtyCount ? "review" : "draft",
      meta: rootOf(p) || p?.sourceFolder,
    });
    document.title = `${name} · 提交與 Diff · Anchorline`;
  }

  function visibleCommits(): NonNullable<GitStats["commits"]> {
    const all = stats?.commits ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (c) =>
        c.subject.toLowerCase().includes(q) ||
        c.hash.toLowerCase().includes(q) ||
        c.author.toLowerCase().includes(q),
    );
  }

  function renderList(): void {
    if (tab === "changes") {
      const n = working?.files.length ?? 0;
      listEl.innerHTML = `<button type="button" class="hv-commit" aria-current="true">
        <span class="hv-av">Δ</span>
        <span><span class="hv-sub">工作區未提交</span>
        <div class="hv-meta-line">${n} 個檔案</div></span></button>`;
      return;
    }
    const rows = visibleCommits();
    if (!rows.length) {
      listEl.innerHTML = `<p class="hv-empty">${stats ? "沒有符合的提交" : "還沒載入歷史"}</p>`;
      return;
    }
    listEl.innerHTML = rows
      .map((c) => {
        const on = c.hash === selectedHash;
        const initial = (c.author.trim()[0] || "?").toUpperCase();
        return `<button type="button" class="hv-commit" data-hash="${escapeHtml(c.hash)}"${
          on ? ' aria-current="true"' : ""
        }>
          <span class="hv-av" aria-hidden="true">${escapeHtml(initial)}</span>
          <span><span class="hv-sub">${escapeHtml(c.subject)}</span>
          <div class="hv-meta-line">${escapeHtml(c.author)} · ${escapeHtml(relativeTime(c.at))} · ${escapeHtml(c.hash)}</div></span>
        </button>`;
      })
      .join("");
  }

  function plusMinus(files: CommitFile[]): { plus: number; minus: number } {
    return files.reduce(
      (a, f) => ({ plus: a.plus + (f.added ?? 0), minus: a.minus + (f.deleted ?? 0) }),
      { plus: 0, minus: 0 },
    );
  }

  function renderHead(): void {
    if (tab === "changes") {
      const pm = plusMinus(working?.files ?? []);
      headEl.innerHTML = `<h2 class="hv-title">未提交的改動</h2>
        <p class="hv-stat"><span>${working?.files.length ?? 0} changed files</span>
        <span><span class="hv-plus">+${pm.plus}</span> <span class="hv-minus">−${pm.minus}</span></span></p>`;
      return;
    }
    if (!detail) {
      headEl.innerHTML = `<p class="hv-empty">選一筆提交。</p>`;
      return;
    }
    const pm = plusMinus(detail.files);
    const body = detail.body.trim()
      ? `<p class="hv-bodytxt">${escapeHtml(detail.body.trim())}</p>`
      : "";
    headEl.innerHTML = `<h2 class="hv-title">${escapeHtml(detail.subject)}</h2>
      ${body}
      <p class="hv-stat"><span>${escapeHtml(detail.author)} · ${escapeHtml(relativeTime(detail.at))} · <span class="mono">${escapeHtml(detail.hash.slice(0, 7))}</span> · ${detail.files.length} changed files</span>
      <span><span class="hv-plus">+${pm.plus}</span> <span class="hv-minus">−${pm.minus}</span></span></p>`;
  }

  function currentFiles(): CommitFile[] {
    return tab === "changes" ? (working?.files ?? []) : (detail?.files ?? []);
  }

  function renderFiles(): void {
    const files = currentFiles();
    filesEl.innerHTML = files
      .map((f) => {
        const on = f.path === selectedPath;
        const add = f.added == null ? "–" : `+${f.added}`;
        const del = f.deleted == null ? "–" : `−${f.deleted}`;
        return `<button type="button" class="hv-file" data-path="${escapeHtml(f.path)}"${
          on ? ' aria-current="true"' : ""
        }><span class="nm" title="${escapeHtml(f.path)}">${escapeHtml(f.path)}</span>
        <span class="hv-nd"><b class="p">${add}</b> <b class="m">${del}</b></span></button>`;
      })
      .join("");
  }

  function currentPatch(): string {
    const raw = tab === "changes" ? (working?.patch ?? "") : (detail?.patch ?? "");
    return selectedPath ? extractFilePatch(raw, selectedPath) : raw;
  }

  function renderDiff(): void {
    const raw = currentPatch();
    const truncated =
      tab === "changes" ? Boolean(working?.truncated) : Boolean(detail?.truncated);
    const warn = truncated
      ? `<p class="hv-empty">這份 diff 超過上限，只顯示前半。完整內容請在終端機用 git show。</p>`
      : "";
    if (!raw.trim() && tab === "changes" && !(working?.files.length)) {
      diffEl.innerHTML = `<p class="hv-empty">工作區是乾淨的。</p>`;
      return;
    }
    diffEl.innerHTML = warn + renderPatch(raw, mode);
  }

  let noteLoadedFor = "";

  function noteKeyOf(): string {
    return tab === "changes" ? "WORKTREE" : selectedHash;
  }

  function renderNote(forceLoad = false): void {
    const p = project();
    const key = noteKeyOf();
    const token = `${p?.id ?? ""}:${key}`;
    if (forceLoad || token !== noteLoadedFor) {
      noteEl.value = p && key ? loadNote(p.id, key) : "";
      noteLoadedFor = token;
    }
    previewEl.innerHTML = renderMarkdown(noteEl.value || "_（空）_");
    const writing = noteMode === "write";
    noteEl.hidden = !writing;
    previewEl.hidden = writing;
    document.getElementById("note-write")?.setAttribute("aria-pressed", writing ? "true" : "false");
    document.getElementById("note-preview")?.setAttribute("aria-pressed", writing ? "false" : "true");
  }

  function render(): void {
    document.getElementById("tab-changes")?.setAttribute("aria-selected", tab === "changes" ? "true" : "false");
    document.getElementById("tab-history")?.setAttribute("aria-selected", tab === "history" ? "true" : "false");
    document.getElementById("mode-unified")?.setAttribute("aria-pressed", mode === "unified" ? "true" : "false");
    document.getElementById("mode-split")?.setAttribute("aria-pressed", mode === "split" ? "true" : "false");
    renderList();
    renderHead();
    renderFiles();
    renderDiff();
    renderNote();
  }

  async function loadCommit(hash: string): Promise<void> {
    const p = project();
    const root = rootOf(p);
    if (!root) return;
    const res = await native.gitCommitDiff(root, hash);
    if (isUnavailable(res)) {
      toast(res.message);
      detail = null;
      return;
    }
    detail = res;
    selectedHash = res.hash;
    selectedPath = res.files[0]?.path ?? "";
    if (res.files[0] && res.patch) {
      const one = await native.gitCommitDiff(root, hash, res.files[0].path);
      if (!isUnavailable(one)) detail = { ...res, patch: one.patch, truncated: one.truncated };
    }
  }

  async function refresh(): Promise<void> {
    if (busy) return;
    const p = project();
    syncChrome(p);
    const root = rootOf(p);
    if (!root) {
      listEl.innerHTML = `<p class="hv-empty">這個專案還沒綁資料夾。到專案儀表板匯入一次。</p>`;
      return;
    }
    if (!native || !("gitCommitDiff" in native)) return;
    busy = true;
    try {
      const s = await requestProjectStats(root);
      stats = s.git ?? null;
      const cs = await native.gitChangeset(root);
      if (isUnavailable(cs)) {
        working = { files: [], patch: "", truncated: false, status: "" };
      } else {
        working = {
          files: parsePorcelain(cs.status).map((f) => ({
            path: f.path,
            added: null,
            deleted: null,
          })),
          patch: cs.patch,
          truncated: cs.truncated,
          status: cs.status,
        };
      }
      const rows = stats?.commits ?? [];
      if (tab === "history") {
        const want = selectedHash && rows.some((c) => c.hash === selectedHash)
          ? selectedHash
          : (rows[0]?.hash ?? "");
        if (want) await loadCommit(want);
        else detail = null;
      }
      render();
      syncChrome(p);
    } catch (e) {
      toast(e instanceof Error ? e.message : "載入失敗");
    } finally {
      busy = false;
    }
  }

  document.getElementById("tab-changes")!.onclick = () => {
    tab = "changes";
    selectedPath = working?.files[0]?.path ?? "";
    render();
  };
  document.getElementById("tab-history")!.onclick = () => {
    tab = "history";
    if (!detail && stats?.commits?.[0]) void loadCommit(stats.commits[0].hash).then(render);
    else render();
  };
  document.getElementById("mode-unified")!.onclick = () => {
    mode = "unified";
    render();
  };
  document.getElementById("mode-split")!.onclick = () => {
    mode = "split";
    render();
  };
  document.getElementById("btn-refresh")!.onclick = () => void refresh();
  filterEl.oninput = () => {
    filter = filterEl.value;
    renderList();
  };
  listEl.onclick = (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-hash]");
    if (!btn?.dataset.hash) return;
    void loadCommit(btn.dataset.hash).then(render);
  };
  filesEl.onclick = (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-path]");
    if (!btn?.dataset.path) return;
    selectedPath = btn.dataset.path;
    const p = project();
    const root = rootOf(p);
    if (tab === "history" && detail && root) {
      void native.gitCommitDiff(root, detail.hash, selectedPath).then((res) => {
        if (!isUnavailable(res) && detail) {
          detail = { ...detail, patch: res.patch, truncated: res.truncated };
        }
        render();
      });
      return;
    }
    render();
  };
  document.getElementById("note-write")!.onclick = () => {
    noteMode = "write";
    renderNote();
  };
  document.getElementById("note-preview")!.onclick = () => {
    noteMode = "preview";
    previewEl.innerHTML = renderMarkdown(noteEl.value || "_（空）_");
    renderNote();
  };
  document.getElementById("note-save")!.onclick = () => {
    const p = project();
    const key = tab === "changes" ? "WORKTREE" : selectedHash;
    if (!p || !key) return;
    saveNote(p.id, key, noteEl.value);
    toast("註解已存在這台機器上");
  };

  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
    const rows = visibleCommits();
    if (tab !== "history" || !rows.length) return;
    const i = Math.max(0, rows.findIndex((c) => c.hash === selectedHash));
    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = rows[Math.min(rows.length - 1, i + 1)];
      if (next) void loadCommit(next.hash).then(render);
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      const prev = rows[Math.max(0, i - 1)];
      if (prev) void loadCommit(prev.hash).then(render);
    }
  });

  store.subscribe(() => {
    const now = rootOf(project());
    if (now) void refresh();
    else syncChrome(project());
  });

  await refresh();
}
