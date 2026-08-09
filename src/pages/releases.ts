/**
 * 版本取號頁。
 *
 * 三件事：取號、編列這一版收哪些功能、一鍵交辦。
 *
 * **版號一律由使用者輸入。** 這一頁沒有任何 +1、沒有預設值、也不會在你
 * 沒填時幫你塞一個。上一版的版號只以「參照」的形式顯示在提示裡，
 * 點不動也不會自動填進欄位 —— 版號是對外承諾，那個決定必須是人做的。
 *
 * 候選項目來自兩處真實資料：PRD 章節（已完成／未完成直接對應章節狀態）
 * 與最近的 commit。再加上自由輸入。不從別處猜。
 */
import { store } from "../data/store";
import { projectDisplayName } from "../data/types";
import {
  buildHandoff,
  lastVersionOf,
  releaseProgress,
  validateVersion,
  type Release,
  type ReleaseItem,
} from "../lib/release";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { initTheme } from "../lib/theme";
import { escapeHtml, initMobileNav, toast, updateUserRailFooter } from "../lib/ui";
import { isDesktop, requestProjectStats, type ProjectStats } from "../lib/project-stats";
import { attachDiffSummary } from "../lib/diff-summary";

if (requireAuth()) {
  initTheme();
  initMobileNav("dashboard");
  bindLogout();
  updateUserRailFooter(toRailUser(store.get().currentUser));
}

let selectedId: string | null = null;
let stats: ProjectStats | null = null;

function activeProject() {
  const st = store.get();
  return st.projects.find((p) => p.id === st.activeProjectId) ?? st.projects[0] ?? null;
}

function selected(): Release | null {
  const list = store.releasesOf();
  return list.find((r) => r.id === selectedId) ?? list[0] ?? null;
}

// ── 候選項目 ────────────────────────────────────────────────────

type Candidate = { text: string; done: boolean; source: ReleaseItem["source"]; ref?: string };

/** PRD 章節：狀態 done 的算已完成，其餘算待開發 */
function sectionCandidates(): Candidate[] {
  const st = store.get();
  return st.sections.map((s) => ({
    text: `${s.n} ${s.title}`,
    done: s.status === "done",
    source: "section" as const,
    ref: s.id,
  }));
}

/** 最近的 commit：已經進版控就是做完的事 */
function commitCandidates(): Candidate[] {
  const commits = stats?.git?.commits ?? [];
  return commits.slice(0, 12).map((c) => ({
    text: c.subject,
    done: true,
    source: "commit" as const,
    ref: c.hash.slice(0, 7),
  }));
}

function alreadyIn(r: Release, c: Candidate): boolean {
  return r.items.some((i) => i.text === c.text || (!!c.ref && i.ref === c.ref));
}

// ── 畫面 ────────────────────────────────────────────────────────

function renderLead() {
  const p = activeProject();
  const lead = document.getElementById("rl-lead");
  if (!lead) return;
  const last = lastVersionOf(p?.id ?? "", store.get().releases);
  lead.innerHTML = p
    ? `目前專案：<strong>${escapeHtml(projectDisplayName(p))}</strong>。${
        last ? `上一個版號是 <strong>${escapeHtml(last)}</strong>（僅供參照，不會自動帶入）。` : "還沒取過任何版號。"
      }`
    : "還沒有選擇專案。請先回總覽挑一個。";
}

function renderList() {
  const host = document.getElementById("rl-list");
  if (!host) return;
  const list = store.releasesOf();
  const cur = selected();
  if (!list.length) {
    host.innerHTML = `<p class="rl-empty">還沒有版號。按右上角「＋ 取一個新版號」開始。</p>`;
    return;
  }
  host.innerHTML = `<ul class="rl-list">${list
    .map((r) => {
      const p = releaseProgress(r);
      return `<li><button type="button" class="rl-item${r.id === cur?.id ? " on" : ""}" data-rl="${r.id}">
        <span class="rl-item-v">
          <strong>${escapeHtml(r.version || "（未命名版號）")}</strong>
          <em>${r.status === "handed" ? "已交辦" : "草稿"}</em>
        </span>
        <span class="rl-item-m">${escapeHtml(r.title || "—")} · ${p.done}/${p.total} 完成</span>
      </button></li>`;
    })
    .join("")}</ul>`;

  host.querySelectorAll<HTMLButtonElement>("[data-rl]").forEach((b) =>
    b.addEventListener("click", () => {
      selectedId = b.dataset.rl ?? null;
      render();
    }),
  );
}

function itemRow(i: ReleaseItem): string {
  const srcLabel = i.source === "section" ? "章節" : i.source === "commit" ? "commit" : "手動";
  return `<li class="rl-row${i.state === "done" ? " is-done" : ""}">
    <button type="button" class="rl-state" data-rl-toggle="${i.id}">${
      i.state === "done" ? "已完成" : "待開發"
    }</button>
    <span class="rl-row-text">${escapeHtml(i.text)}</span>
    <span class="rl-row-src">${srcLabel}${i.ref ? `·${escapeHtml(i.ref)}` : ""}</span>
    <button type="button" class="rl-row-del" data-rl-del="${i.id}" aria-label="移除">×</button>
  </li>`;
}

function candidateHtml(r: Release): string {
  const cands = [...sectionCandidates(), ...commitCandidates()].filter((c) => !alreadyIn(r, c));
  if (!cands.length) {
    return `<p class="rl-empty">沒有其他候選項目了。用下面的欄位自己加。</p>`;
  }
  return `<div class="rl-cands">${cands
    .map(
      (c, idx) =>
        `<button type="button" class="rl-cand" data-rl-cand="${idx}">
          <span class="tag">${c.done ? "已完成" : "待開發"}</span>
          <span>${escapeHtml(c.text)}</span>
        </button>`,
    )
    .join("")}</div>`;
}

function renderDetail() {
  const host = document.getElementById("rl-detail");
  if (!host) return;
  const r = selected();
  if (!r) {
    host.innerHTML = `<h2>版本內容</h2><p class="rl-empty">先取一個版號，再回來編列內容。</p>`;
    return;
  }
  const p = releaseProgress(r);

  host.innerHTML = `
    <h2>${escapeHtml(r.version || "（尚未填版號）")} 的內容</h2>
    <div class="b">
      <div class="rl-field">
        <label for="rl-version">版號</label>
        <input type="text" id="rl-version" value="${escapeHtml(r.version)}"
               placeholder="自己決定，例如 v1.2.0 / 2026.08 / R42" autocomplete="off" spellcheck="false" />
        <span class="hint">系統不會幫你編號，也不會自動 +1。格式只擋掉 git tag 不接受的字元與重複。</span>
        <span class="err" id="rl-version-err"></span>
      </div>
      <div class="rl-field">
        <label for="rl-title">這一版的名字</label>
        <input type="text" id="rl-title" value="${escapeHtml(r.title)}" placeholder="例如：結帳改版" />
      </div>
      <div class="rl-field">
        <label for="rl-note">版本說明</label>
        <textarea id="rl-note" rows="3" placeholder="這一版做了什麼、範圍在哪、誰會受影響">${escapeHtml(r.note)}</textarea>
      </div>

      <p class="rl-sub">這一版收納的功能（${p.done} 已完成 / ${p.planned} 待開發）</p>
      ${
        r.items.length
          ? `<ul class="rl-items">${r.items.map(itemRow).join("")}</ul>`
          : `<p class="rl-empty">還沒有項目。從下面挑，或自己輸入。</p>`
      }
      <div class="rl-add">
        <input type="text" id="rl-manual" placeholder="自己輸入一個項目，Enter 加入" />
        <button type="button" class="btn btn-sm" id="rl-manual-add">加入</button>
      </div>

      <p class="rl-sub">從既有資料挑（章節狀態與 commit 都是實際量到的）</p>
      ${candidateHtml(r)}
    </div>
    <div class="rl-foot">
      <span class="rl-prog">${p.done}/${p.total} 完成 · ${p.pct}%</span>
      ${r.handedAt ? `<span class="rl-handed">已於 ${escapeHtml(r.handedAt.slice(0, 16).replace("T", " "))} 交辦</span>` : ""}
      <span class="sp"></span>
      <button type="button" class="btn btn-sm" id="rl-copy">複製交辦單</button>
      <button type="button" class="btn btn-sm btn-ghost" id="rl-del">刪除這一版</button>
      <button type="button" class="btn btn-primary" id="rl-hand">送交執行</button>
    </div>
  `;

  bindDetail(r);
}

function bindDetail(r: Release) {
  const ver = document.getElementById("rl-version") as HTMLInputElement;
  const err = document.getElementById("rl-version-err") as HTMLElement;
  const saveVersion = () => {
    const v = validateVersion(ver.value, r.projectId, store.get().releases, r.id);
    if (!v.ok) {
      ver.classList.add("bad");
      err.textContent = v.reason;
      return;
    }
    ver.classList.remove("bad");
    err.textContent = "";
    if (ver.value.trim() === r.version) return;
    store.updateRelease(r.id, { version: ver.value.trim() });
    render();
  };
  ver.addEventListener("blur", saveVersion);
  ver.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      e.preventDefault();
      ver.blur();
    }
  });

  const title = document.getElementById("rl-title") as HTMLInputElement;
  title.addEventListener("blur", () => {
    if (title.value.trim() !== r.title) store.updateRelease(r.id, { title: title.value.trim() });
  });
  const note = document.getElementById("rl-note") as HTMLTextAreaElement;
  // 版本說明是要發出去給人看的，存檔前先看到自己改了哪些字
  attachDiffSummary(note, () => r.note);
  attachDiffSummary(title, () => r.title);
  note.addEventListener("blur", () => {
    if (note.value.trim() !== r.note) store.updateRelease(r.id, { note: note.value.trim() });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-rl-toggle]").forEach((b) =>
    b.addEventListener("click", () => {
      const item = r.items.find((i) => i.id === b.dataset.rlToggle);
      if (!item) return;
      store.updateReleaseItem(r.id, item.id, { state: item.state === "done" ? "planned" : "done" });
      render();
    }),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-rl-del]").forEach((b) =>
    b.addEventListener("click", () => {
      store.removeReleaseItem(r.id, b.dataset.rlDel ?? "");
      render();
    }),
  );

  const manual = document.getElementById("rl-manual") as HTMLInputElement;
  const addManual = () => {
    const text = manual.value.trim();
    if (!text) return;
    manual.value = "";
    store.addReleaseItem(r.id, { text, state: "planned", source: "manual" });
    render();
    (document.getElementById("rl-manual") as HTMLInputElement | null)?.focus();
  };
  document.getElementById("rl-manual-add")?.addEventListener("click", addManual);
  manual.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      e.preventDefault();
      addManual();
    }
  });

  const cands = [...sectionCandidates(), ...commitCandidates()].filter((c) => !alreadyIn(r, c));
  document.querySelectorAll<HTMLButtonElement>("[data-rl-cand]").forEach((b) =>
    b.addEventListener("click", () => {
      const c = cands[Number(b.dataset.rlCand)];
      if (!c) return;
      store.addReleaseItem(r.id, {
        text: c.text,
        state: c.done ? "done" : "planned",
        source: c.source,
        ref: c.ref,
      });
      render();
    }),
  );

  document.getElementById("rl-del")?.addEventListener("click", () => {
    if (!window.confirm(`要刪掉「${r.version || "這一版"}」嗎？`)) return;
    store.deleteRelease(r.id);
    selectedId = null;
    render();
  });

  document.getElementById("rl-copy")?.addEventListener("click", async () => {
    const p = activeProject();
    try {
      await navigator.clipboard.writeText(buildHandoff(r, p ? projectDisplayName(p) : "—"));
      toast("交辦單已複製");
    } catch {
      toast("複製失敗");
    }
  });

  document.getElementById("rl-hand")?.addEventListener("click", () => void hand(r));
}

/**
 * 送交執行 —— 一顆按鈕做三件事：
 * 1. 檢查版號真的填了（沒填就不讓送，這一版根本還沒成立）
 * 2. 把交辦單丟進 Agent 佇列（store.invokeAgent，跟其他呼叫走同一條路）
 * 3. 順手複製到剪貼簿，讓你也能貼給人
 */
async function hand(r: Release) {
  const v = validateVersion(r.version, r.projectId, store.get().releases, r.id);
  if (!v.ok) {
    toast(`還不能送：${v.reason}`);
    return;
  }
  if (!r.items.length) {
    toast("這一版還沒有任何項目，先編列內容");
    return;
  }
  const p = activeProject();
  const md = buildHandoff(r, p ? projectDisplayName(p) : "—");

  const agent = store
    .get()
    .employees.find(
      (e) => e.kind === "agent" && e.active !== false && e.agentEnabled !== false &&
        (e.accessRole === "editor" || e.accessRole === "admin"),
    );

  try {
    await navigator.clipboard.writeText(md);
  } catch {
    /* 剪貼簿失敗不影響主流程 */
  }

  if (!agent) {
    store.markReleaseHanded(r.id);
    render();
    toast("交辦單已複製。沒有可用的 Agent —— 到 Agent 管理啟用一個就能直接派工");
    return;
  }

  const res = store.invokeAgent({
    agentId: agent.id,
    projectId: r.projectId,
    task: "edit",
    note: md,
  });
  if (!res.ok) {
    toast(res.reason ?? "派工失敗（交辦單已複製）");
    return;
  }
  store.markReleaseHanded(r.id);
  render();
  toast(`已交給 ${agent.name} 執行，交辦單也複製了一份`);
}

function render() {
  renderLead();
  renderList();
  renderDetail();
}

document.getElementById("rl-new")?.addEventListener("click", () => {
  const p = activeProject();
  if (!p) {
    toast("先選一個專案");
    return;
  }
  const r = store.createRelease(p.id);
  selectedId = r.id;
  render();
  (document.getElementById("rl-version") as HTMLInputElement | null)?.focus();
});

render();

// commit 候選要等磁碟量測回來；量不到就只用章節，不擋畫面
const path = activeProject()?.importSummary?.rootPath;
if (path && isDesktop()) {
  requestProjectStats(path)
    .then((s) => {
      stats = s;
      render();
    })
    .catch(() => {
      /* 量不到就算了 */
    });
}

// ponytail: 候選只取章節與最近 12 筆 commit。
// 再多來源（plans/、openspec tasks）等真的有人抱怨挑不到再加。
