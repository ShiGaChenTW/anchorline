/**
 * OpenSpec 入口：開新的 change。
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
import { askConfirm } from "../lib/ask";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import {
  buildChangeFiles,
  CHANGE_KIND_LABEL,
  deriveChangeSlug,
  draftKindRules,
  type ChangeFile,
  type ChangeKind,
} from "../lib/change-templates";
import {
  applyDraft,
  buildDraftUser,
} from "../lib/change-templates";
import { AiError, chatCompletion, extractJsonObject, getAiReadiness } from "../lib/ai-client";
import { projectDisplayName } from "../data/types";
import { isNative, isUnavailable, native } from "../lib/native";
import { WRITING_DISCIPLINE } from "../lib/ai-tells";
import { promptSystem, promptTemperature } from "../lib/prompt-registry";
import { clampForContext } from "../lib/project-snapshot";
import {
  makeSnapshot,
  openSnapshot,
  NO_SNAPSHOT,
  readSnapshotState,
  readSnapshotText,
  snapshotLine,
} from "../lib/snapshot-bridge";
import { sinceLabel as since } from "../lib/time-format";
import {
  briefFromWishes,
  emptyWishlist,
  parseWishlist,
  readWishHandoff,
  titleFromWishes,
  wishOptionLabel,
  wishlistLsKey,
  wishlistPath,
  type WishHandoff,
  type WishlistDoc,
} from "../lib/function-wishlist";
import { canEditFiles, readFile } from "../lib/file-editor";
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
  /** null = 還沒選類型，第 2、3 步因此鎖著 */
  let kind: ChangeKind | null = null;
  /**
   * AI 產生的初稿。非 null 時預覽與下載都用它。
   *
   * 換類型或改標題會清掉 —— 那份初稿是照舊的標題寫的，
   * 留著會讓下載到的東西跟畫面上填的對不起來。
   */
  let draftFiles: ChangeFile[] | null = null;
  /** 這個專案的分析報告狀態。判定與文案共用 `snapshot-bridge` */
  let snapState = NO_SNAPSHOT;
  /** 勾了要寫哪幾份。key 是檔名 */
  const picked = new Set<string>();
  /** 從 Function wish list 送來的願望正文。餵給 AI 初稿當「要寫什麼」。 */
  let wishBrief = "";

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

  // ── 三步驟 ───────────────────────────────────────────────────

  function filesFromForm(): ChangeFile[] | null {
    if (!kind) return null;
    const title = val("os-title").trim();
    if (!title) return null;
    const slug = deriveChangeSlug(val("os-slug")) ?? deriveChangeSlug(title);
    if (!slug) return null;
    const base = buildChangeFiles(kind, { title, slug, date: new Date().toISOString().slice(0, 10) });
    // AI 初稿只在標題與類型都沒變的情況下才算數
    if (draftFiles && draftFiles.length === base.length) {
      return base.map((f, i) => ({ ...f, content: draftFiles![i]!.content }));
    }
    return base;
  }

  // ── 專案 ─────────────────────────────────────────────────────

  /**
   * 專案選單。**選了要同步 store 的 activeProject**，
   * 否則這一頁跟側欄會各講各的：側欄顯示 A、這裡在替 B 產生文件。
   */
  /**
   * 這個專案有沒有 openspec 骨架。
   *
   * 沒有的話這一頁做出來的 change 放回去也沒有東西會讀它 ——
   * 所以要紅字講清楚，並且給一顆能當場解決的按鈕，
   * 而不是把人踢去終端機再自己回來。
   */
  async function checkInit() {
    const box = el("os-init");
    const warn = el("os-init-warn");
    if (!box || !warn) return;
    const p = currentProject();
    const root = p?.importSummary?.rootPath;
    if (!root || !isNative()) {
      box.hidden = true;
      return;
    }
    try {
      const r = await native.openspecProbe(root);
      box.hidden = r.initialized;
      if (!r.initialized) warn.textContent = "這個專案還沒有 openspec/ —— change 放回去不會被讀到。";
    } catch {
      box.hidden = true;
    }
  }

  function renderProjectPicker() {
    const sel = el("os-project") as HTMLSelectElement | null;
    const note = el("os-scope-note");
    if (!sel) return;
    const list = projects();
    const cur = currentProject();
    sel.innerHTML = list.length
      ? list
          .map(
            (p) =>
              `<option value="${p.id}"${p.id === cur?.id ? " selected" : ""}>${escapeHtml(projectDisplayName(p))}</option>`,
          )
          .join("")
      : `<option value="">（還沒有專案）</option>`;
    sel.disabled = !list.length;
    if (note) {
      note.textContent = cur?.importSummary?.rootPath
        ? "已綁定資料夾，可以讀 OpenSpec 狀態"
        : cur
          ? "尚未綁定資料夾 —— 讀不到既有的 change，但仍可產生文件"
          : "先建立或匯入一個專案";
    }
  }

  // ── 帶入願望 ─────────────────────────────────────────────────

  /** 與編輯台同一套讀法：桌面版讀專案資料夾裡的檔，瀏覽器版退 localStorage。 */
  let wishDoc: WishlistDoc = emptyWishlist();

  async function loadWishlist(): Promise<WishlistDoc> {
    const p = currentProject();
    if (!p) return emptyWishlist();
    const root = p.importSummary?.rootPath;
    if (root && canEditFiles()) {
      try {
        return parseWishlist(await readFile(wishlistPath(root)));
      } catch {
        /* 檔還不存在是常態，不是錯誤 */
      }
    }
    try {
      const raw = localStorage.getItem(wishlistLsKey(p.id));
      return raw ? parseWishlist(raw) : emptyWishlist();
    } catch {
      return emptyWishlist();
    }
  }

  async function refreshWishPicker() {
    wishDoc = await loadWishlist();
    renderWishPicker();
  }

  function renderWishPicker() {
    const wrap = el("os-wish-pick-wrap");
    const sel = el("os-wish-pick") as HTMLSelectElement | null;
    if (!wrap || !sel) return;
    const items = wishDoc.active;
    wrap.hidden = !items.length;
    sel.innerHTML =
      `<option value="">（選一條願望，自動填下方）</option>` +
      items
        .map((it) => `<option value="${escapeHtml(it.id)}">${escapeHtml(wishOptionLabel(it))}</option>`)
        .join("");
    sel.value = "";
  }

  el("os-wish-pick")?.addEventListener("change", (e) => {
    const sel = e.target as HTMLSelectElement;
    const it = wishDoc.active.find((w) => w.id === sel.value);
    sel.value = ""; // 歸位，同一條願望才能重選一次（重選 = 重新帶入）
    if (!it) return;
    const brief = el("os-ai-brief") as HTMLTextAreaElement | null;
    if (brief) brief.value = ""; // consume 只填空欄，先清掉舊願望的說明才換得掉
    consumeWishHandoff({
      projectId: currentProject()?.id ?? "",
      kind: it.kind ?? "feature",
      items: [{ id: it.id, text: it.text, kind: it.kind }],
    });
    renderSteps();
  });

  // ── 版號 ─────────────────────────────────────────────────────

  /**
   * 要收進哪一版。
   *
   * **只列尚未放行的版號。** 已放行的 `canAddItem` 會擋，
   * 讓它出現在清單裡只是製造一次注定失敗的選擇。
   * 已經被別的版號收走的 change 也不重複列。
   */
  function renderReleasePicker() {
    const sel = el("os-release") as HTMLSelectElement | null;
    const note = el("os-release-note");
    if (!sel) return;
    const p = currentProject();
    const open = p ? store.releasesOf(p.id).filter((r) => !r.releasedAt) : [];
    const keep = sel.value;
    sel.innerHTML =
      `<option value="">加入該專案</option>` +
      open
        .map(
          (r) =>
            `<option value="${r.id}">${escapeHtml(r.version || "（未命名版號）")}${r.title ? ` · ${escapeHtml(r.title)}` : ""}</option>`,
        )
        .join("");
    sel.value = open.some((r) => r.id === keep) ? keep : "";
    if (note) {
      note.textContent = open.length
        ? "選「加入該專案」就只是建立 change，不綁版號。收進某一版之後，那一版的 YY 閘門才有 change 可以認。"
        : "這個專案還沒有未放行的版號。選「加入該專案」先建立，之後到「版本取號」再收。";
    }
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

    renderPreview(files);
    renderPicks();
  }

  /** 目前預覽的是第幾個檔。換一組檔案時要夾住，否則切到不存在的索引會空白 */
  let previewIdx = 0;

  /**
   * 右欄：**要產生的檔案內容**。
   *
   * 原本第 3 步只列檔名，那回答的是「會產生幾個檔」，
   * 而使用者要判斷的是「裡面寫什麼」。按下去會發生什麼，
   * 該在按之前就讀得到。
   */
  function renderPreview(files: ChangeFile[] | null) {
    const tabs = el("os-preview-tabs");
    const body = el("os-preview-body");
    const count = el("os-preview-count");
    if (!tabs || !body) return;

    if (!files || !files.length) {
      tabs.innerHTML = "";
      if (count) count.textContent = "";
      body.className = "os-preview-body os-preview-empty";
      body.textContent = kind
        ? "填上標題與 change id，這裡就會顯示每一份檔案的完整內容。"
        : "先在左邊選這次是哪一種，這裡會列出要產生的檔案並顯示內容。";
      return;
    }

    previewIdx = Math.min(previewIdx, files.length - 1);
    if (count) count.textContent = `${files.length} 份`;

    tabs.innerHTML = files
      .map((f, i) => {
        const name = f.path.split("/").pop() ?? f.path;
        return `<button type="button" class="os-preview-tab${i === previewIdx ? " on" : ""}"
                  role="tab" aria-selected="${i === previewIdx}" data-file="${i}"
                  title="${escapeHtml(f.path)}">${escapeHtml(name)}</button>`;
      })
      .join("");
    tabs.querySelectorAll<HTMLButtonElement>("[data-file]").forEach((b) => {
      b.onclick = () => {
        previewIdx = Number(b.dataset.file);
        renderPreview(files);
      };
    });

    const cur = files[previewIdx]!;
    body.className = "os-preview-body";
    // 路徑放在內容最上面 —— 檔名在分頁上是縮寫，完整路徑才知道要放回哪裡
    body.textContent = `${cur.path}\n${"─".repeat(Math.min(cur.path.length, 60))}\n\n${cur.content}`;
  }

  function download(file: ChangeFile) {
    const url = URL.createObjectURL(new Blob([file.content], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = file.path.replaceAll("/", "__");
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── 綁定 ─────────────────────────────────────────────────────

  document.querySelectorAll<HTMLButtonElement>(".os-kind").forEach((btn) => {
    btn.onclick = () => {
      kind = btn.dataset.kind as ChangeKind;
      draftFiles = null; // 初稿是照舊類型寫的，留著會跟畫面對不起來
      renderSteps();
      // 選完類型直接把游標送到標題 —— 少一次「接下來要點哪裡」的決定
      (el("os-title") as HTMLInputElement | null)?.focus();
    };
  });

  el("os-title")?.addEventListener("input", (e) => {
    draftFiles = null;
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

  /**
   * 直接寫進專案資料夾。
   *
   * 這一頁原本刻意只產生文件——理由寫在說明彈窗裡：「讓 App 直接寫檔，等於把它
   * 變成可以在你所有專案裡任意建檔的東西」。那個顧慮是對的，但它的解法不是
   * 不寫檔，而是**把可寫的範圍縮成可驗證的白名單**：只有使用者親手選過的專案根、
   * 只有 openspec/changes/<id>/ 與 plans/ 那幾種形狀、撞名整批中止。守門全在
   * Rust 端（`write_change_bundle`），前端這一層只負責問清楚再送出。
   *
   * 順帶一提，這條界線其實早就被別的功能跨過了：工作台-OpenSpec 的編輯欄會寫
   * 使用者專案裡的檔，願望清單會寫 `.anchorline/function-wishlist.md`。維持這一頁
   * 唯讀只讓行為不一致，沒有換到任何安全性。
   */
  el("os-write")?.addEventListener("click", async () => {
    const files = filesFromForm();
    if (!files || !kind) return;
    if (!isNative()) {
      feedback("瀏覽器版沒有檔案系統，請用「建立並下載」。", "error");
      return;
    }
    const root = currentProject()?.importSummary?.rootPath;
    if (!root) {
      feedback("這個專案還沒有綁定資料夾，寫不進去。用「建立並下載」或先去專案匯入。", "error");
      return;
    }
    // 寫進使用者的專案是不可逆的（撞名會被擋，但寫進去的檔案要自己刪），
    // 所以把完整路徑攤出來讓人看過再按。
    const ok = await askConfirm({
      title: `要把 ${files.length} 份文件寫進這個專案嗎？`,
      body: files.map((f) => `${root.replace(/\/+$/, "")}/${f.path}`).join("\n"),
    });
    if (!ok) return;

    const btn = el("os-write") as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    try {
      const r = await native.writeChangeBundle(
        root,
        files.map((f) => ({ rel: f.path, content: f.content })),
      );
      if (!r || isUnavailable(r)) {
        feedback(r && isUnavailable(r) ? r.message : "寫入失敗。", "error");
        return;
      }
      const extra = attachToRelease();
      feedback(`已寫入 ${r.paths.length} 份${CHANGE_KIND_LABEL[kind]}文件。${extra}`, "ok");
      toast("文件已寫進專案，接著到 Task Tracking 勾選步驟");
    } catch (e) {
      // Rust 的錯誤訊息本身就是給人看的（撞名時會列出是哪幾個檔），直接顯示
      feedback(e instanceof Error ? e.message : "寫入失敗。", "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  el("os-download")?.addEventListener("click", () => {
    const files = filesFromForm();
    if (!files || !kind) return;
    files.forEach(download);
    const extra = attachToRelease();
    feedback(`已下載 ${files.length} 份${CHANGE_KIND_LABEL[kind]}文件。${extra}`, "ok");
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

  el("os-project")?.addEventListener("change", (e) => {
    const id = (e.target as HTMLSelectElement).value;
    if (!id) return;
    selectedProjectId = id;
    // 同步 store，否則這一頁跟側欄會各講各的
    store.setActiveProject(id);
    renderProjectPicker();
    renderReleasePicker();
    void checkInit();
    void refreshSnapshot();
    void refreshWishPicker();
  });

  el("os-init-run")?.addEventListener("click", async () => {
    const p = currentProject();
    const root = p?.importSummary?.rootPath;
    if (!root) return;
    const btn = el("os-init-run") as HTMLButtonElement;
    const warn = el("os-init-warn");
    if (
      !(await askConfirm({
        title: [
          `要在「${projectDisplayName(p!)}」執行 openspec init 嗎？`,
          "",
          `它會在 ${root} 底下建立 openspec/ 骨架。`,
          "",
          "這是這個 App 唯一會寫進你專案資料夾的動作。",
          "不想要的話刪掉那個資料夾就還原了。",
        ].join("\n"),
        danger: true,
      }))
    )
      return;
    btn.disabled = true;
    if (warn) warn.textContent = "執行中…";
    try {
      const r = await native.openspecInit(root);
      if (isUnavailable(r)) {
        if (warn) warn.textContent = r.message;
        return;
      }
      toast("openspec init 完成");
      await checkInit();
    } catch (e) {
      if (warn) warn.textContent = e instanceof Error ? e.message : String(e);
    } finally {
      btn.disabled = false;
    }
  });

  // ── AI 撰寫 ───────────────────────────────────────────────────

  /**
   * 給模型的背景。
   *
   * 新專案沒有資料夾可讀，用使用者填的問答；既有專案用**分析報告**加 PRD。
   * 分析報告是那份「完整讀過資料夾」的東西 —— 少了它，模型只有一個標題，
   * 而它會很流暢地寫出一份跟這個 repo 沒有關係的提案。
   */
  async function aiContext(): Promise<string> {
    const wish = wishBrief.trim() && `期望功能（來自 Function wish list）：\n${wishBrief.trim()}`;
    if (isNewProject()) {
      const brief = (el("os-ai-brief") as HTMLTextAreaElement | null)?.value.trim() ?? "";
      return [wish, brief && `使用者說明：\n${brief}`, prdContext()].filter(Boolean).join("\n\n");
    }
    const root = currentProject()?.importSummary?.rootPath;
    let snap = "";
    if (root && snapState.name) {
      const raw = await readSnapshotText(root, snapState.name);
      if (raw) {
        // 存的是全部，送的是一段 —— 整份丟進 prompt 會撐爆 context window
        const c = clampForContext(raw);
        snap = c.text;
        if (c.clamped) toast("分析報告較長，只送出前段給模型");
      }
    }
    return [wish, snap && `專案分析報告（${snapState.name}）：\n${snap}`, prdContext()].filter(Boolean).join("\n\n");
  }

  function applyWishHandoff() {
    const h = readWishHandoff();
    if (!h) return;
    consumeWishHandoff(h);
  }

  function consumeWishHandoff(h: WishHandoff) {
    wishBrief = briefFromWishes(h.items);
    if (h.projectId && projects().some((p) => p.id === h.projectId)) {
      selectedProjectId = h.projectId;
      store.setActiveProject(h.projectId);
    }
    // 第 1 步：類型。wishlist 選過的就是這次要寫的那一種。
    kind = (h.kind ?? h.items[0]?.kind ?? "feature") as ChangeKind;
    const title = titleFromWishes(h.items);
    const titleEl = el("os-title") as HTMLInputElement | null;
    if (titleEl) titleEl.value = title;
    const slugEl = el("os-slug") as HTMLInputElement | null;
    if (slugEl) {
      slugEl.value = deriveChangeSlug(title) ?? deriveChangeSlug(h.items[0]?.id ?? "") ?? "";
      slugEl.dataset.edited = slugEl.value ? "1" : "";
    }
    const briefEl = el("os-ai-brief") as HTMLTextAreaElement | null;
    if (briefEl && !briefEl.value.trim()) briefEl.value = wishBrief;

    const banner = el("os-wish-banner");
    const list = el("os-wish-banner-list");
    if (banner && list) {
      const kindLabel = CHANGE_KIND_LABEL[kind] ?? kind;
      list.innerHTML = h.items
        .map((it) => `<li>${escapeHtml(it.text)}</li>`)
        .join("");
      banner.hidden = false;
      const hint = banner.querySelector(".os-wish-banner-hint");
      if (hint) {
        hint.textContent = `已填入類型「${kindLabel}」與標題。可直接產出分析報告，再按 AI 撰寫初稿。`;
      }
    }
  }

  /** 專案的 PRD 內容，給模型當背景。沒有就是空字串，prompt 會明講。 */
  function prdContext(): string {
    const p = currentProject();
    if (!p) return "";
    const st = store.get();
    const vals = st.projectSectionValues?.[p.id] ?? {};
    return st.sections
      .map((sec) => {
        const body = Object.values(vals[sec.id] ?? {})
          .filter(Boolean)
          .join("\n")
          .trim();
        return body ? `## ${sec.n} ${sec.title}\n${body}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
  }

  // ── 專案分析報告：AI 撰寫的前置條件 ──────────────────────────────

  /** 新專案＝沒有綁定資料夾。沒有資料夾可讀，所以不要求分析報告，改走問答。 */
  function isNewProject(): boolean {
    return !currentProject()?.importSummary?.rootPath;
  }

  async function refreshSnapshot() {
    const root = currentProject()?.importSummary?.rootPath;
    snapState = await readSnapshotState(root, commitTimes);
    renderSnapshotLine();
  }

  /**
   * 報告狀態。三種話各自不同，因為下一步不同：
   * 新專案（不需要報告）· 有報告且新（可以寫）· 沒有或落後（要先產出）。
   */
  function renderSnapshotLine() {
    const line = el("os-ai-snap");
    const scanBtn = el("os-ai-scan") as HTMLButtonElement | null;
    const qa = el("os-ai-qa");
    const aiBtn = el("os-ai") as HTMLButtonElement | null;
    if (!line || !scanBtn || !aiBtn) return;

    // 文案與判定跟 PRD 撰寫共用 `snapshot-bridge` —— 兩邊各寫一份的話，
    // 同一個專案會在兩頁顯示不同的報告狀態
    const age = snapState.at ? since(snapState.at.toISOString(), Date.now()) : "";
    line.textContent = snapshotLine(snapState, age);
    line.className = `os-ai-snap${
      !snapState.required ? "" : snapState.unavailable || !snapState.at ? " is-block" : snapState.stale?.stale ? " is-stale" : ""
    }`;
    qa && (qa.hidden = snapState.required);
    // 更新與否是使用者的決定，所以按鈕一直在，只是換字
    scanBtn.hidden = !snapState.required || snapState.unavailable;
    scanBtn.textContent = snapState.at ? "重新分析" : "產出分析報告";
    const openBtn = el("os-ai-open") as HTMLButtonElement | null;
    if (openBtn) openBtn.hidden = !snapState.path;
    aiBtn.disabled = snapState.required && !snapState.unavailable && !snapState.at;
  }

  /** 報告落後判定要用的 commit 時間。這一頁沒有專案統計，先留空 ——
      年齡那一半的判定仍然有效（超過 7 天照樣提醒）。 */
  const commitTimes: string[] = [];

  el("os-ai-open")?.addEventListener("click", () => void openSnapshot(snapState.path));

  el("os-ai-scan")?.addEventListener("click", async () => {
    const p = currentProject();
    const root = p?.importSummary?.rootPath;
    const line = el("os-ai-snap");
    if (!root) return;
    if (snapState.at && !(await askConfirm({ title: "要重新讀一次整個專案資料夾，產出新的分析報告嗎？（舊的會留著）" }))) return;
    const btn = el("os-ai-scan") as HTMLButtonElement;
    btn.disabled = true;
    if (line) line.textContent = "讀取整個專案資料夾中…";
    const r = await makeSnapshot(root, projectDisplayName(p!));
    if (!r.ok) {
      if (line) line.textContent = r.reason;
    } else {
      toast(r.truncated ? `已分析 ${r.files} 個檔（有上限，未讀完）` : `已分析 ${r.files} 個檔`);
      await refreshSnapshot();
    }
    btn.disabled = false;
  });

  /** 要寫哪幾份。預設全勾 —— 多數情況是整組寫，勾選是給要局部重寫的人用的。 */
  function renderPicks() {
    const host = el("os-ai-picks");
    if (!host) return;
    const files = filesFromForm();
    if (!files) {
      host.innerHTML = `<p class="os-ai-hint">填完標題與 change id 之後，這裡會列出可以寫的檔案。</p>`;
      return;
    }
    const names = files.map((f) => f.path.split("/").pop() ?? f.path);
    for (const n of names) if (!picked.has(n)) picked.add(n);
    host.innerHTML = names
      .map(
        (n) =>
          `<label class="os-ai-check"><input type="checkbox" data-pick="${escapeHtml(n)}"${picked.has(n) ? " checked" : ""} /> ${escapeHtml(n)}</label>`,
      )
      .join("");
    host.querySelectorAll<HTMLInputElement>("[data-pick]").forEach((c) => {
      c.onchange = () => {
        const n = c.dataset.pick!;
        c.checked ? picked.add(n) : picked.delete(n);
      };
    });
  }

  el("os-ai")?.addEventListener("click", async () => {
    const status = el("os-ai-status");
    const say = (m: string, bad = false) => {
      if (status) {
        status.textContent = m;
        status.className = `os-ai-status${bad ? " is-error" : ""}`;
      }
    };

    const ready = getAiReadiness();
    if (!ready.ok) {
      // reason 本身已經寫了去哪裡設定，再接一次就是同一句話講兩遍
      say(ready.reason, true);
      return;
    }
    // 既有專案沒有分析報告就不給寫 —— 沒讀過專案寫出來的文件是編的
    if (snapState.required && !snapState.unavailable && !snapState.at) {
      say("先按「產出分析報告」讀一次專案資料夾。", true);
      return;
    }
    const title = val("os-title").trim();
    const slug = deriveChangeSlug(val("os-slug")) ?? deriveChangeSlug(title);
    if (!kind || !title || !slug) {
      say("先選類型並填好標題與 change id。", true);
      return;
    }

    const btn = el("os-ai") as HTMLButtonElement;
    btn.disabled = true;
    say("撰寫中…");
    try {
      const base = buildChangeFiles(kind, { title, slug, date: new Date().toISOString().slice(0, 10) });
      // 只送勾到的那幾份給模型 —— 沒勾的不必花 token，也不會被動到
      const want = base.filter((f) => picked.has(f.path.split("/").pop() ?? f.path));
      if (!want.length) {
        say("至少勾一份要寫的檔案。", true);
        return;
      }
      const raw = await chatCompletion(
        // 模板走 registry（id: openspec-draft），使用者可在設定覆寫
        promptSystem("openspec-draft", { kindRules: draftKindRules(kind), discipline: WRITING_DISCIPLINE }),
        buildDraftUser({ kind, title, slug, prdContext: await aiContext(), files: want }),
        { temperature: promptTemperature("openspec-draft") },
      );
      const applied = applyDraft(want, extractJsonObject(raw));
      // 沒勾的沿用目前內容（可能是骨架，也可能是上一輪的初稿）
      const current = draftFiles ?? base;
      const files = base.map((f, i) => {
        const hit = applied.files.find((x) => x.path === f.path);
        return hit && hit.content !== f.content ? hit : current[i]!;
      });
      const filled = applied.filled;
      if (!filled) {
        say("模型沒有回傳可用的內容，再試一次。", true);
        return;
      }
      draftFiles = files;
      renderSteps();
      // 說出填了幾份 —— 少填的那幾份仍然是骨架，使用者有權知道
      say(
        filled === want.length
          ? `已產生 ${filled} 份初稿`
          : `已產生 ${filled} / ${want.length} 份，其餘保留原內容`,
      );
    } catch (e) {
      say(e instanceof AiError ? e.message : String(e), true);
    } finally {
      btn.disabled = false;
    }
  });

  /**
   * 把這個 change 收進選定的版號。
   *
   * 只在 feature 走 —— bug 與維護產出的是 `plans/` 檔，不是 openspec change，
   * 而版號的 YY 閘門認的是 change。
   */
  function attachToRelease(): string {
    const relId = (el("os-release") as HTMLSelectElement | null)?.value ?? "";
    if (!relId || kind !== "feature") return "";
    const slug = deriveChangeSlug(val("os-slug")) ?? deriveChangeSlug(val("os-title").trim());
    if (!slug) return "";
    const r = store.addReleaseItem(relId, {
      text: val("os-title").trim() || slug,
      state: "planned",
      source: "change",
      ref: slug,
    });
    renderReleasePicker();
    return r.ok ? "已收進選定的版號。" : `版號未收：${r.reason ?? "失敗"}`;
  }

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
  el("os-wish-banner-dismiss")?.addEventListener("click", () => {
    const banner = el("os-wish-banner");
    if (banner) banner.hidden = true;
  });

  applyWishHandoff();
  renderProjectPicker();
  renderReleasePicker();
  renderSteps();
  void checkInit();
  void refreshSnapshot();
  void refreshWishPicker();

  store.subscribe(() => {
    updateUserRailFooter(toRailUser(store.get().currentUser));
    // 側欄換了專案就要重讀 —— 只重畫的話會停在上一個專案的版號與願望，
    // 而且沒有任何提示說「這不是你現在選的那個」
    const active = store.get().activeProjectId ?? "";
    if (active && active !== selectedProjectId) {
      selectedProjectId = active;
      renderProjectPicker();
      renderReleasePicker();
      void checkInit();
      void refreshSnapshot();
      void refreshWishPicker();
      return;
    }
    renderReleasePicker();
  });
}
