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
import { askConfirm } from "../lib/ask";
import {
  buildHandoff,
  lastVersionOf,
  policyOf,
  releaseProgress,
  validateVersion,
  type Release,
  type ReleaseItem,
} from "../lib/release";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { initTheme } from "../lib/theme";
import { escapeHtml, initMobileNav, toast, updateUserRailFooter } from "../lib/ui";
import {
  claimedRefs,
  LEVEL_BLURB,
  LEVEL_LABEL,
  LEVEL_SEGMENT,
  pushGate,
  suggestNext,
  type GateFacts,
  type ReleaseLevel,
} from "../lib/release-track";
import { isDesktop, requestProjectStats, type ProjectStats } from "../lib/project-stats";
import { requestOpenspecStatus } from "../lib/status-bridge";
import type { OpenspecChange } from "../lib/openspec-status";
import { attachDiffSummary } from "../lib/diff-summary";

if (requireAuth()) {
  initTheme();
  initMobileNav("releases");
  bindLogout();
  updateUserRailFooter(toRailUser(store.get().currentUser));
}

let selectedId: string | null = null;
let stats: ProjectStats | null = null;
/** openspec change 的名稱與完成度。讀不到就是空陣列 —— 沒裝 openspec 不是錯誤。 */
let openspecChanges: { name: string; isComplete: boolean }[] = [];

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

/**
 * openspec change：還沒實作的東西。
 *
 * 只用 CLI `--json` 給的名稱與完成度（D10：不解析 spec.md）。
 * 已完成的 change 也列出來 —— 一個版號可以收「剛做完但還沒發版」的東西。
 */
function changeCandidates(): Candidate[] {
  return openspecChanges.map((c) => ({
    text: c.name,
    done: c.isComplete,
    source: "change" as const,
    ref: c.name,
  }));
}

/**
 * 候選來源。
 *
 * 層級（X/YY/ZZ）管的是**取號的條件**，不是「能收什麼」——
 * 一個大型迭代本來就會同時收 change 與 commit。所以這裡不分流，
 * 三種來源都列出來，由 `levelGate()` 去判斷這一版夠不夠格取那個號。
 */
function candidatesFor(_r: Release): Candidate[] {
  return [...changeCandidates(), ...sectionCandidates(), ...commitCandidates()];
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

/**
 * PUSH 閘門。
 *
 * `shipped` 有版號有內容就能出；`planned` 要等收進來的 change 全部完成，
 * 而且**未完成的要逐一列出來** —— 「還不能 push」沒有下一步，
 * 「這三個 change 還沒完成」才有。
 *
 * 產出一樣是可複製的指令，不代跑：push 出去收不回來。
 */
/**
 * 畫面上看得到的候選 —— **渲染與點擊必須共用這一支**。
 *
 * 兩邊各自組一次清單的話，索引會對不上：畫面照過濾後的順序畫，
 * 點擊照未過濾的順序取，於是點 A 加進 B。而且不會報錯。
 */
function visibleCandidates(r: Release): Candidate[] {
  const claimed = claimedRefs(r.projectId, store.releasesOf(r.projectId), r.id);
  return candidatesFor(r).filter((c) => !alreadyIn(r, c) && !(c.ref && claimed.has(c.ref)));
}

/**
 * 閘門要的外部事實。
 *
 * `hasApprovedPrd`：這個專案有沒有「全部必簽關卡通過且已合併」的 PRD 版本。
 * 判定沿用既有資料（簽核個案 + prdVersions 的 merge），不新增欄位。
 */
/**
 * 版號欄位底下那一行，要說得出**現在這個專案用哪一套**。
 *
 * 使用者在這一頁看到「格式不符」的時候，需要知道兩件事：規則是什麼、
 * 以及去哪裡改。少了後者，他會在這一頁找開關，而開關在專案設定 ——
 * 那是專案層級的一次性決定，不該混在每次取號都要碰的地方。
 */
function policyHint(projectId: string): string {
  const proj = store.get().projects.find((x) => x.id === projectId);
  if (policyOf(proj) === "strict") {
    return "這個專案採 vX.YY.ZZ（YY 與 ZZ 補兩位）。X 要 PRD 簽核紀錄、YY 要走過 OpenSpec、ZZ 挑 commit。系統不會自動 +1。";
  }
  return "這個專案不限版號格式，只擋掉 git tag 不接受的字元與重複。想改採 vX.YY.ZZ 的三段規則，到專案儀表板的專案設定切換（不可逆）。";
}

function gateFacts(r: Release): GateFacts {
  const merged = store.prdBaseline(r.projectId) !== null;
  const c = store.get().cases[r.projectId];
  const settled =
    !!c &&
    !c.withdrawn &&
    c.stages.filter((s) => s.required !== false).every((s) => s.state === "approved");
  return { hasApprovedPrd: merged && settled, items: r.items };
}

/**
 * 取號閘門與放行狀態。
 *
 * 三種狀態在畫面上必須分得出來，因為下一步完全不同：
 * 閘門沒過（去補條件）· 取了號還沒放行（正常的預先作業）· 已放行（可以出）。
 * 全部說成「還不能 PUSH」會讓人以為壞掉了。
 */
function pushGateHtml(r: Release): string {
  const proj = store.get().projects.find((x) => x.id === r.projectId);
  const g = pushGate(r, gateFacts(r), policyOf(proj));
  const seg =
    policyOf(proj) === "loose"
      ? "寬鬆版號"
      : r.level
        ? `${LEVEL_SEGMENT[r.level]}｜${LEVEL_LABEL[r.level]}`
        : "規則上路前的版號";

  if (g.ok) {
    return `<div class="rl-push is-ready">
      <div class="rl-push-head"><strong>已放行，可以 PUSH</strong>
        <span class="rl-push-track">${escapeHtml(seg)}</span></div>
      <pre class="rl-push-cmd"><code>${escapeHtml(g.command)}</code></pre>
      <div class="rl-push-row">
        <button type="button" class="btn btn-sm" id="rl-push-copy" data-cmd="${escapeHtml(g.command)}">複製標籤與推送指令</button>
        <button type="button" class="btn btn-sm btn-ghost" id="rl-unrelease">撤回放行</button>
      </div>
      <p class="rl-push-note">指令不會自動執行 —— 複製到終端機自己跑。</p>
    </div>`;
  }

  // 閘門過了、只差放行 —— 這是預先作業的正常狀態，要給按鈕而不是只給理由。
  // 確認**做在卡片裡**（按第一下變成紅色的「確認放行」），不用 window.confirm ——
  // 系統對話框在桌面殼壞過一次（2026-08-14），關鍵路徑不再壓在它身上
  const onlyNeedsRelease = !r.releasedAt && g.reason.includes("還沒放行");
  return `<div class="rl-push${onlyNeedsRelease ? " is-planned" : ""}">
    <div class="rl-push-head"><strong>${onlyNeedsRelease ? "已取號，尚未放行" : "還不能取這個號"}</strong>
      <span class="rl-push-track">${escapeHtml(seg)}</span></div>
    <p class="rl-push-why">${escapeHtml(g.reason)}</p>
    <p class="rl-push-fix">${escapeHtml(g.fix)}</p>
    ${
      onlyNeedsRelease
        ? `<span class="rl-arm">
             <button type="button" class="btn btn-sm btn-primary" id="rl-release">正式放行</button>
             <button type="button" class="btn btn-sm rl-arm-go" id="rl-release-go" hidden>確認放行 —— 之後內容不能再改</button>
             <button type="button" class="btn btn-sm btn-ghost" id="rl-release-cancel" hidden>先不要</button>
           </span>`
        : ""
    }
  </div>`;
}

const RUN_ICON: Record<string, string> = {
  queued: "⏳",
  running: "⏳",
  done: "✅",
  failed: "❌",
  cancelled: "⊘",
};
const RUN_LABEL: Record<string, string> = {
  queued: "排隊中",
  running: "執行中",
  done: "已完成",
  failed: "失敗",
  cancelled: "已取消",
};

/**
 * 這一版的執行紀錄 —— 每一次送交都留一筆，結果全文就地展開。
 *
 * 「送交執行」按完只多一行時間戳、結果要跳去 Agent 管理翻，
 * 是 2026-08-14 被點名的兩個問題。紀錄不另外造表：`agentJobs`
 * 本來就隨 App 資料持久化，這裡只是把 releaseId 對得上的撈出來。
 */
function runsHtml(r: Release): string {
  const jobs = store.get().agentJobs.filter((j) => j.releaseId === r.id);
  if (!r.handedAt && !jobs.length) return "";

  const rows = jobs
    .map((j, i) => {
      const when = j.createdAt.slice(5, 16).replace("T", " ");
      const body =
        j.status === "queued" || j.status === "running"
          ? `<p class="rl-run-wait">執行中 —— 跑完結果會直接出現在這裡。</p>`
          : `<pre class="rl-run-out">${escapeHtml(j.result || "（沒有輸出）")}</pre>`;
      return `<details class="rl-run"${i === 0 ? " open" : ""}>
        <summary>${RUN_ICON[j.status] ?? "·"} ${escapeHtml(j.agentName)} · ${escapeHtml(when)} · ${RUN_LABEL[j.status] ?? j.status}${
          j.status === "failed" ? " —— 可再按「送交執行」重派" : ""
        }</summary>
        ${body}
      </details>`;
    })
    .join("");

  return `<details class="aiw-fold rl-runs" open>
    <summary>執行紀錄 <span class="aiw-fold-meta">${jobs.length || "0"} 筆</span></summary>
    ${rows || `<p class="rl-run-wait">交辦單已產生（沒有派給 App 內的 Agent，或由人工接手）。</p>`}
    <p class="rl-next-steps">下一步：實作完成後把「待開發」項目勾成完成 → 按「正式放行」→ 複製 PUSH 指令到終端機執行。</p>
  </details>`;
}

function candidateHtml(r: Release): string {
  const cands = visibleCandidates(r);
  if (!cands.length) {
    return `<p class="rl-empty">沒有其他候選項目了（已被其他版號收走的不會出現）。用下面的欄位自己加。</p>`;
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
        <span class="hint">${policyHint(r.projectId)}</span>
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
    ${pushGateHtml(r)}
    ${runsHtml(r)}
    <div class="rl-foot">
      <span class="rl-prog">${p.done}/${p.total} 完成 · ${p.pct}%</span>
      ${r.handedAt ? `<span class="rl-handed">已於 ${escapeHtml(r.handedAt.slice(0, 16).replace("T", " "))} 交辦</span>` : ""}
      <span class="sp"></span>
      <button type="button" class="btn btn-sm btn-ghost" id="rl-del">刪除這一版</button>
      <button type="button" class="btn btn-sm" id="rl-copy">複製交辦單</button>
      <button type="button" class="btn btn-primary" id="rl-hand">送交執行</button>
    </div>
    <div class="rl-hand-pick" id="rl-hand-pick" hidden></div>
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
    const add = store.addReleaseItem(r.id, { text, state: "planned", source: "manual" });
    if (!add.ok) {
      toast(add.reason ?? "加不進去");
      return;
    }
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

  const cands = visibleCandidates(r);
  document.querySelectorAll<HTMLButtonElement>("[data-rl-cand]").forEach((b) =>
    b.addEventListener("click", () => {
      const c = cands[Number(b.dataset.rlCand)];
      if (!c) return;
      // store 會擋跨路線與已被佔用的 ref；擋下來的理由要顯示，不要靜靜不動作
      const add = store.addReleaseItem(r.id, {
        text: c.text,
        state: c.done ? "done" : "planned",
        source: c.source,
        ref: c.ref,
      });
      if (!add.ok) toast(add.reason ?? "加不進去");
      render();
    }),
  );

  document.getElementById("rl-del")?.addEventListener("click", async () => {
    if (!(await askConfirm({ title: `要刪掉「${r.version || "這一版"}」嗎？`, danger: true }))) return;
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

  // 兩段式確認做在畫面裡，不用 window.confirm —— 桌面殼的系統對話框
  // 壞過一次（回報「按了沒用」），不可逆操作的確認不再壓在它身上
  const armBtn = document.getElementById("rl-release");
  const goBtn = document.getElementById("rl-release-go");
  const cancelBtn = document.getElementById("rl-release-cancel");
  armBtn?.addEventListener("click", () => {
    armBtn.hidden = true;
    if (goBtn) goBtn.hidden = false;
    if (cancelBtn) cancelBtn.hidden = false;
  });
  cancelBtn?.addEventListener("click", () => {
    if (armBtn) armBtn.hidden = false;
    if (goBtn) goBtn.hidden = true;
    cancelBtn.hidden = true;
  });
  goBtn?.addEventListener("click", () => {
    const res = store.releaseNow(r.id);
    toast(res.ok ? "已放行，可以 PUSH 了" : (res.reason ?? "放行失敗"));
    render();
  });
  document.getElementById("rl-unrelease")?.addEventListener("click", () => {
    const res = store.unreleaseNow(r.id);
    toast(res.ok ? "已撤回放行" : (res.reason ?? "撤回失敗"));
    render();
  });

  document.getElementById("rl-push-copy")?.addEventListener("click", async (e) => {
    const cmd = (e.currentTarget as HTMLElement).dataset.cmd ?? "";
    try {
      await navigator.clipboard.writeText(cmd);
      toast("指令已複製，到終端機執行");
    } catch {
      toast("複製失敗，請手動選取");
    }
  });

  // 送交執行 = 先挑派給誰。誰執行是使用者的決定，不是清單順序的決定
  document.getElementById("rl-hand")?.addEventListener("click", () => {
    if (!handGate(r)) return;
    const pick = document.getElementById("rl-hand-pick");
    if (!pick) return;
    if (!pick.hidden) {
      pick.hidden = true;
      return;
    }
    const agents = eligibleAgents();
    pick.innerHTML = `
      <p class="rl-hand-pick-head">派給誰執行？</p>
      ${agents
        .map(
          (a) =>
            `<button type="button" class="btn btn-sm" data-rl-agent="${escapeHtml(a.id)}">${escapeHtml(a.name)} · ${a.accessRole === "admin" ? "管理" : "編輯"}</button>`,
        )
        .join("")}
      <button type="button" class="btn btn-sm btn-ghost" data-rl-agent="">只複製交辦單（貼給外部工具或人）</button>
      ${agents.length ? "" : `<p class="rl-hand-pick-none">沒有啟用中的編輯 Agent —— 到 <a href="agents.html">Agent 管理</a> 啟用，或直接用複製的交辦單。</p>`}
    `;
    pick.hidden = false;
    pick.querySelectorAll<HTMLButtonElement>("[data-rl-agent]").forEach((b) => {
      b.addEventListener("click", () => {
        pick.hidden = true;
        void hand(r, b.dataset.rlAgent || null);
      });
    });
  });
}

/**
 * 送交執行 —— 一顆按鈕做三件事：
 * 1. 檢查版號真的填了（沒填就不讓送，這一版根本還沒成立）
 * 2. 把交辦單丟進 Agent 佇列（store.invokeAgent，跟其他呼叫走同一條路）
 * 3. 順手複製到剪貼簿，讓你也能貼給人
 */
/** 有資格接單的 Agent：啟用中、編輯或管理角色 */
function eligibleAgents() {
  return store
    .get()
    .employees.filter(
      (e) => e.kind === "agent" && e.active !== false && e.agentEnabled !== false &&
        (e.accessRole === "editor" || e.accessRole === "admin"),
    );
}

/**
 * 送交前先過一次共同閘門；過了才讓使用者挑要派給誰。
 * 原本是**自動拿第一個啟用的 Agent** —— 使用者沒選過 Claude Code，
 * 畫面卻顯示 Claude Code 執行中（2026-08-14 回報「很怪」，確實很怪）。
 */
function handGate(r: Release): boolean {
  const v = validateVersion(r.version, r.projectId, store.get().releases, r.id);
  if (!v.ok) {
    toast(`還不能送：${v.reason}`);
    return false;
  }
  if (!r.items.length) {
    toast("這一版還沒有任何項目，先編列內容");
    return false;
  }
  return true;
}

async function hand(r: Release, agentId: string | null) {
  const p = activeProject();
  const md = buildHandoff(r, p ? projectDisplayName(p) : "—");

  try {
    await navigator.clipboard.writeText(md);
  } catch {
    /* 剪貼簿失敗不影響主流程 */
  }

  // agentId null = 只複製交辦單，不派給 App 內的 Agent ——
  // 貼給終端機裡真的會寫 code 的東西（Claude Code CLI、Codex…）
  if (!agentId) {
    store.markReleaseHanded(r.id);
    render();
    toast("交辦單已複製 —— 貼給你要的執行者（CLI agent 或人）");
    return;
  }

  const agent = eligibleAgents().find((e) => e.id === agentId);
  if (!agent) {
    toast("這個 Agent 已停用，換一個吧");
    return;
  }

  const res = store.invokeAgent({
    agentId: agent.id,
    projectId: r.projectId,
    task: "edit",
    note: md,
    // 綁回這一版：詳情卡才能顯示「執行中／完成／失敗」與下一步
    releaseId: r.id,
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
  // loose 政策沒有段落語意，不必問層級
  if (policyOf(p) === "loose") {
    const r0 = store.createRelease(p.id);
    selectedId = r0.id;
    void loadOpenspecChanges();
    render();
    (document.getElementById("rl-version") as HTMLInputElement | null)?.focus();
    return;
  }

  // 層級決定取號要過哪一道閘門，所以建立時就要選。
  // 選擇做在**頁面裡的三顆按鈕**，不用 window.prompt（Grok C11）：
  // prompt 是系統面板——js_dialogs 補丁失效或舊 build 時 `pick===null`
  // 直接 return，症狀是「按了零回饋」（2026-08-15 dogfood 實測踩到）；
  // 對 agent 自動化也完全不可及。與「確認放行做在卡片裡」同一條原則。
  toggleLevelPick();
});

function toggleLevelPick() {
  const existing = document.getElementById("rl-level-pick");
  if (existing) {
    existing.remove();
    return;
  }
  const btn = document.getElementById("rl-new");
  if (!btn) return;
  const box = document.createElement("div");
  box.id = "rl-level-pick";
  box.className = "rl-level-pick";
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", "這一版動哪一段");
  const LEVELS: ReleaseLevel[] = ["patch", "minor", "major"];
  box.innerHTML = LEVELS.map(
    (lv) => `<button type="button" class="btn btn-sm" data-level="${lv}"
       title="${LEVEL_BLURB[lv]}">${LEVEL_SEGMENT[lv]}｜${LEVEL_LABEL[lv]}</button>`,
  ).join("");
  box.querySelectorAll<HTMLButtonElement>("[data-level]").forEach((b) => {
    b.onclick = () => {
      box.remove();
      mintAtLevel(b.dataset["level"] as ReleaseLevel);
    };
  });
  btn.insertAdjacentElement("afterend", box);
}

function mintAtLevel(level: ReleaseLevel) {
  const p = activeProject();
  if (!p) return;
  const r = store.createRelease(p.id, level);
  // 建議版號放進欄位讓人改 —— 建議不是自動指定，最終決定仍然是使用者的
  const prev = lastVersionOf(p.id, store.releasesOf(p.id).filter((x) => x.id !== r.id));
  store.updateRelease(r.id, { version: suggestNext(prev, level) });
  selectedId = r.id;
  void loadOpenspecChanges();
  render();
  (document.getElementById("rl-version") as HTMLInputElement | null)?.focus();
}

/**
 * 讀 openspec change 的名稱與完成度。
 *
 * 讀不到一律當成沒有 change（空陣列），不是錯誤 —— 沒裝 openspec 的專案
 * 走「未實作」路線時候選會是空的，畫面已經對這件事有交代。
 */
async function loadOpenspecChanges(): Promise<void> {
  const root = activeProject()?.importSummary?.rootPath;
  if (!root || !isDesktop()) return;
  try {
    const r = await requestOpenspecStatus(root);
    openspecChanges = r.available
      ? r.changes.map((c: OpenspecChange) => ({ name: c.name, isComplete: c.isComplete }))
      : [];
  } catch {
    openspecChanges = [];
  }
  render();
}

render();

// 交辦的 Agent 跑完時狀態列要自己翻頁，不能等使用者重新整理。
// **只在工作單狀態變了才重畫**：這一頁沒有全域 subscribe 是刻意的 ——
// 每次 emit 都重畫會把使用者正在打的版號欄位洗掉。
let lastJobKey = "";
store.subscribe(() => {
  const r = selected();
  if (!r?.handedAt) return;
  const key = store
    .get()
    .agentJobs.filter((x) => x.releaseId === r.id)
    .map((x) => `${x.id}:${x.status}`)
    .join("|");
  if (key !== lastJobKey) {
    lastJobKey = key;
    render();
  }
});

// 已經有 planned 版號就要把 change 狀態讀進來，否則 PUSH 閘門會全部說「沒完成」
// change 候選與 YY 閘門都要 openspec 狀態，一進頁就讀
void loadOpenspecChanges();

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
