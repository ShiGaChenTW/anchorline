/**
 * OpenSpec 入口。
 *
 * ## 版面順序是這一頁的主要設計決定
 *
 * 這一頁的功能是**開新的 change**。若預設動線是「進來 → 開一個新的」，
 * 介面就是在替「開很多坑收不完」加速。所以進行中的 change 置頂：
 * 開新坑之前先看見還沒收完的坑，要不要繼續開是一個有意識的決定。
 *
 * ## 一次只指一個
 *
 * 建立流程拆成三步，一次只有一步是亮的。後面的步驟**dim 但不隱藏** ——
 * 隱藏會讓版面在每次選擇後跳動，而版面一跳就得重新找自己在哪。
 *
 * I/O 全在這裡，判定在 `lib/` 的純函式。
 */
import { store } from "../data/store";
import type { Project } from "../data/types";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import {
  buildChangeFiles,
  CHANGE_KIND_LABEL,
  deriveChangeSlug,
  type ChangeFile,
  type ChangeKind,
} from "../lib/change-templates";
import { canQueryStatus, requestOpenspecStatus } from "../lib/status-bridge";
import { nextArtifact, type OpenspecChange, type OpenspecResult } from "../lib/openspec-status";
import { sinceLabel } from "../lib/time-format";
import {
  bindModalDismiss,
  closeModal,
  escapeHtml,
  initMobileNav,
  openModal,
  toast,
  updateUserRailFooter,
} from "../lib/ui";
import { initTheme } from "../lib/theme";

if (requireAuth()) {
  initTheme();
  initMobileNav("openspec");
  bindModalDismiss("os-help-modal");
  bindLogout();
  updateUserRailFooter(toRailUser(store.get().currentUser));

  let selectedProjectId = store.get().activeProjectId ?? "";
  let report: OpenspecResult | null = null;
  /** 上次掃描完成的時間。null = 還沒掃過 */
  let scannedAt: string | null = null;
  /** null = 還沒選類型，第 2、3 步因此鎖著 */
  let kind: ChangeKind | null = null;

  function projects(): Project[] {
    const st = store.get();
    return st.projects.filter((p) => st.showSamples || !p.isSample);
  }

  function currentProject(): Project | null {
    return projects().find((p) => p.id === selectedProjectId) ?? projects()[0] ?? null;
  }

  const el = (id: string) => document.getElementById(id);
  const val = (id: string) => (el(id) as HTMLInputElement | null)?.value ?? "";

  function setErr(id: string, msg: string) {
    const n = el(id);
    if (n) n.textContent = msg;
  }

  function feedback(text: string, tone: "ok" | "error" = "ok") {
    const n = el("os-feedback");
    if (!n) return;
    n.textContent = text;
    n.className = `os-feedback os-feedback--${tone}`;
  }

  // ── 開放迴圈帶 ────────────────────────────────────────────────

  /** list 有 `lastModified`，status 沒有 —— 兩邊用 change 名稱對起來 */
  function lastModifiedOf(name: string): string | null {
    if (!report?.available) return null;
    return report.listed?.find((l) => l.name === name)?.lastModified || null;
  }

  function progressOf(c: OpenspecChange): number {
    const done = c.artifacts.filter((a) => a.status === "done" || a.status === "skipped").length;
    return c.artifacts.length ? Math.round((done / c.artifacts.length) * 100) : 0;
  }

  function renderOpenLoops() {
    const host = el("os-open");
    const body = el("os-open-body");
    const scanned = el("os-scanned");
    if (!host || !body) return;

    const p = currentProject();
    const open = report?.available ? report.changes.filter((c) => !c.isComplete) : [];

    // 沒有專案、沒綁資料夾、讀不到、或全部收完 —— 整條收起來。
    // 一個空的開放迴圈帶仍然佔注意力，而它什麼都沒在說。
    if (!p || !open.length) {
      host.hidden = true;
      return;
    }
    host.hidden = false;

    if (scanned) scanned.textContent = scannedAt ? `掃描於 ${sinceLabel(scannedAt, Date.now())}` : "掃描中…";

    body.innerHTML = open
      .map((c) => {
        const pct = progressOf(c);
        const next = nextArtifact(c);
        const age = lastModifiedOf(c.name);
        return `<div class="os-open-row">
          <div class="os-open-main">
            <span class="os-open-id">${escapeHtml(c.name)}</span>
            <span class="os-open-next">${next ? `下一步：${escapeHtml(next.outputPath)}` : "等待前置條件"}</span>
          </div>
          <span class="os-open-age">${age ? escapeHtml(sinceLabel(age, Date.now())) : "—"}</span>
          <span class="os-open-pct">${pct}%</span>
          <span class="os-open-bar"><span style="width:${pct}%"></span></span>
        </div>`;
      })
      .join("");
  }

  // ── 三步驟 ───────────────────────────────────────────────────

  function filesFromForm(): ChangeFile[] | null {
    if (!kind) return null;
    const title = val("os-title").trim();
    if (!title) return null;
    const slug = deriveChangeSlug(val("os-slug")) ?? deriveChangeSlug(title);
    if (!slug) return null;
    return buildChangeFiles(kind, { title, slug, date: new Date().toISOString().slice(0, 10) });
  }

  /**
   * 每一步的鎖定狀態與預覽。
   *
   * 判準只有兩個，都很便宜：選了類型才開第 2 步；第 2 步填得出合法的
   * 標題 + slug 才開第 3 步。第 3 步一開就直接把**會產生哪幾個檔**列出來 ——
   * 「按下去會發生什麼」應該在按下去之前就看得到。
   */
  function renderSteps() {
    document.querySelectorAll<HTMLElement>(".os-kind").forEach((b) => {
      b.setAttribute("aria-checked", b.dataset.kind === kind ? "true" : "false");
    });

    const step2 = document.querySelector<HTMLElement>('.os-step[data-step="2"]');
    const step3 = document.querySelector<HTMLElement>('.os-step[data-step="3"]');
    step2?.classList.toggle("is-locked", !kind);

    const title = val("os-title").trim();
    const rawSlug = val("os-slug");
    const slug = deriveChangeSlug(rawSlug) ?? deriveChangeSlug(title);

    // 只在「已經打了字但推不出 slug」時說話 —— 還沒開始打就報錯是 RSD 觸發器
    setErr(
      "os-slug-err",
      title && !slug ? "標題推不出英數 change id，請自己填一個（會變成資料夾／檔名）" : "",
    );

    const files = filesFromForm();
    step3?.classList.toggle("is-locked", !files);

    const list = el("os-files");
    if (list) {
      list.innerHTML = files
        ? files.map((f) => `<li>${escapeHtml(f.path)}</li>`).join("")
        : `<li style="border-style:dashed">填完上一步就會列出要產生的檔案</li>`;
    }
  }

  function download(file: ChangeFile) {
    const url = URL.createObjectURL(new Blob([file.content], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = file.path.replaceAll("/", "__");
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── 掃描 ─────────────────────────────────────────────────────

  async function refresh() {
    const p = currentProject();
    report = null;
    scannedAt = null;
    renderOpenLoops();

    if (!p?.importSummary?.rootPath || !canQueryStatus()) {
      report = {
        available: false,
        reason: !canQueryStatus() ? "OpenSpec 狀態需要桌面版原生橋。" : "尚未綁定專案資料夾。",
      };
      renderOpenLoops();
      return;
    }
    report = await requestOpenspecStatus(p.importSummary.rootPath);
    scannedAt = new Date().toISOString();
    renderOpenLoops();
  }

  // ── 綁定 ─────────────────────────────────────────────────────

  document.querySelectorAll<HTMLButtonElement>(".os-kind").forEach((btn) => {
    btn.onclick = () => {
      kind = btn.dataset.kind as ChangeKind;
      renderSteps();
      // 選完類型直接把游標送到標題 —— 少一次「接下來要點哪裡」的決定
      (el("os-title") as HTMLInputElement | null)?.focus();
    };
  });

  el("os-title")?.addEventListener("input", (e) => {
    const slug = el("os-slug") as HTMLInputElement | null;
    if (slug && !slug.dataset.edited) {
      // 推不出來就留空 —— 把保底值寫進欄位會讓人以為系統已經幫他決定好了
      slug.value = deriveChangeSlug((e.target as HTMLInputElement).value) ?? "";
    }
    renderSteps();
  });

  el("os-slug")?.addEventListener("input", (e) => {
    (e.target as HTMLInputElement).dataset.edited = "1";
    renderSteps();
  });

  el("os-download")?.addEventListener("click", () => {
    const files = filesFromForm();
    if (!files || !kind) return;
    files.forEach(download);
    feedback(`已下載 ${files.length} 份${CHANGE_KIND_LABEL[kind]}文件。`, "ok");
    toast("文件已下載，請放回上面列出的路徑");
  });

  el("os-copy")?.addEventListener("click", async () => {
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

  el("os-refresh")?.addEventListener("click", () => void refresh());

  // ── 操作說明 ─────────────────────────────────────────────────

  /** 切到某一條路線的說明。開啟時跟著目前選中的類型走 —— 已經選了新功能
      還要再點一次「新功能」分頁，是白白多一個決定。 */
  function showHelp(k: ChangeKind) {
    document.querySelectorAll<HTMLElement>(".osh-tab").forEach((t) => {
      const on = t.dataset.kind === k;
      t.classList.toggle("on", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll<HTMLElement>(".osh-panel").forEach((p) => {
      p.hidden = p.dataset.kind !== k;
    });
  }

  document.querySelectorAll<HTMLButtonElement>(".osh-tab").forEach((t) => {
    t.onclick = () => showHelp(t.dataset.kind as ChangeKind);
  });

  el("os-help-open")?.addEventListener("click", () => {
    showHelp(kind ?? "feature");
    openModal("os-help-modal");
  });
  el("osh-close")?.addEventListener("click", () => closeModal("os-help-modal"));
  el("osh-done")?.addEventListener("click", () => closeModal("os-help-modal"));

  renderSteps();
  renderOpenLoops();
  void refresh();

  store.subscribe(() => {
    updateUserRailFooter(toRailUser(store.get().currentUser));
    // 側欄換了專案就要重掃 —— 只重畫的話會停在上一個專案的 change 清單，
    // 而且沒有任何提示說「這不是你現在選的那個」
    const active = store.get().activeProjectId ?? "";
    if (active && active !== selectedProjectId) {
      selectedProjectId = active;
      void refresh();
      return;
    }
    renderOpenLoops();
  });
}
