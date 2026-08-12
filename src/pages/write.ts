/**
 * AI 撰寫 —— 從「寫作教練」第三欄獨立出來的一整頁。
 *
 * 為什麼要獨立：AI 撰寫是「一次動整份 PRD」的動作，卻被塞在一個
 * 「一次看一節」的側欄裡。要看它寫得對不對得跳章節，要重跑得先回到教練欄，
 * 而它產出的東西（全部章節的草稿）在那個寬度裡根本攤不開。
 *
 * 這一頁只有兩種狀態，開頁就決定：
 *
 *   有 PRD → dashboard：適用模板 / 各階段評分 / 簽核狀態 / 改善與修復建議
 *   沒 PRD → 創建引導：AI 撰寫（提問引導、讀資料夾）與建立空白範本
 *
 * 產出一律進**草稿**，跟編輯台同一條規則 —— AI 寫的東西沒有理由跳過
 * 「使用者明確按下儲存」這一關。
 */
import { store, evaluateChecks } from "../data/store";
import { projectDisplayName, type Project, type Section } from "../data/types";
import { domainPacks } from "../data/domains";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { getAiReadiness, writeFullPrd } from "../lib/ai-coach";
import { openOptimizeWorkbench } from "../lib/ai-optimize";
import { openWriteConsole } from "../lib/ai-write-console";
import { restorePlan, snapshotDrafts, type TouchedField } from "../lib/draft-snapshot";
import {
  makeSnapshot,
  NO_SNAPSHOT,
  readSnapshotState,
  readSnapshotText,
  snapshotLine,
} from "../lib/snapshot-bridge";
import { clampForContext } from "../lib/project-snapshot";
import { isDesktop, requestProjectStats } from "../lib/project-stats";
import { sinceLabel } from "../lib/time-format";
import { chatCompletion } from "../lib/ai-client";
import { runSectionCoach } from "../lib/gate-rules";
import {
  interviewInstruction,
  MAX_INTERVIEW_TURNS,
  nextInterviewQuestion,
  type InterviewTurn,
} from "../lib/ai-interview";
import {
  mapCandidateToSectionValues,
  scanFolderFromFileList,
  scanFromNativeFolder,
  SLOT_META,
  type ProjectCandidate,
} from "../lib/folder-import";
import { initHelpOverlay } from "../lib/help-overlay";
import { isNative, native } from "../lib/native";
import { canEditContent } from "../lib/permissions";
import { CHARS_PER_MIN, DEFAULT_TARGET } from "../lib/focus-mode";
import { evaluatePrdGates, gateSummaryLine } from "../lib/prd-gates";
import { syncRailContext } from "../lib/rail-projects";
import { initTheme } from "../lib/theme";
import { bindModalDismiss, closeModal, escapeHtml, initMobileNav, openModal, toast, updateUserRailFooter } from "../lib/ui";
import { starterScaffold } from "../lib/writing-assist";

if (!requireAuth()) {
  /* redirected */
} else {
  initTheme();
  bindModalDismiss("aiw-plan");
  initMobileNav("write");
  bindLogout();
  initHelpOverlay();

  const root = document.getElementById("aiw-root");

  /**
   * 執行狀態放模組層而不是 render 內：這一頁每做完一件事就整段重畫，
   * 狀態放在 render 裡第一次重畫就沒了（教練欄踩過同一個坑）。
   */
  let abort: AbortController | null = null;

  /** 提問引導的狀態；null = 還沒開始 */
  let interview: {
    turns: InterviewTurn[];
    question: string | null;
    why: string;
    busy: boolean;
    finished: boolean;
  } | null = null;

  /** 資料夾掃描結果，讓使用者在產出前看得到「讀到了什麼」 */
  let folder: { candidate: ProjectCandidate; name: string } | null = null;

  // ── 資料 ────────────────────────────────────────────────────

  function activeProject(): Project | null {
    const st = store.get();
    const visible = st.projects.filter((p) => (st.showSamples ? true : !p.isSample));
    const picked = visible.find((p) => p.id === st.activeProjectId) ?? visible[0] ?? null;
    // 草稿是用 activeProjectId 當 key 的 —— 落回第一個專案卻不設定它，
    // AI 寫出來的東西會存到別的專案底下
    if (picked && picked.id !== st.activeProjectId) store.setActiveProject(picked.id);
    return picked;
  }

  function sections(): Section[] {
    return store.get().sections;
  }

  /** 這一節畫面上該顯示的內容 = 已儲存疊上草稿 */
  function valuesFor(s: Section): Record<string, string> {
    const st = store.get();
    const saved = st.sectionValues[s.id] ?? {};
    const draft = st.prdDrafts[st.activeProjectId]?.[s.id];
    return draft ? { ...saved, ...draft } : saved;
  }

  /**
   * 這個專案算不算「已有 PRD」。
   *
   * 只看**已儲存**的正文，不看草稿：草稿是「AI 寫了但你還沒收下」，
   * 把它算進來的話，第一次按下 AI 撰寫之後創建引導頁就再也回不去了。
   */
  function hasPrd(): boolean {
    const st = store.get();
    return sections().some((s) =>
      Object.values(st.sectionValues[s.id] ?? {}).some((v) => String(v).trim().length > 0),
    );
  }

  function editable(): boolean {
    return canEditContent(store.get().currentUser);
  }

  // ── 頁面外框 ────────────────────────────────────────────────

  function syncChrome(p: Project | null) {
    updateUserRailFooter(toRailUser(store.get().currentUser));
    const name = p ? projectDisplayName(p) : "未選擇專案";
    const on = hasPrd();
    const h1 = document.querySelector<HTMLElement>('[data-od-id="page-title"]');
    if (h1) h1.textContent = "PRD 審閱監控";
    const sub = document.querySelector<HTMLElement>('[data-od-id="page-sub"]');
    if (sub) sub.textContent = p ? `${name} · ${on ? "已有 PRD" : "尚未建立 PRD"}` : "先建立或選擇一個專案";
    // 「AI 撰寫」鈕只在已有 PRD 時出現 —— 沒有 PRD 的時候引導頁自己就有兩個入口，
    // 工具列再放一顆等於同一個決定要做兩次
    const write = document.getElementById("btn-aiw-write");
    if (write) write.hidden = !on || !p;
    syncRailContext({
      mode: "PRD 審閱監控",
      projectName: name,
      statusLabel: p?.status === "approved" ? "已核准" : p?.status === "review" ? "審閱中" : "草稿",
      statusTone: p?.status === "approved" ? "ok" : p?.status === "review" ? "review" : "draft",
      meta: p?.domain,
    });
    document.title = `PRD 審閱監控 · ${name} · Anchorline`;
  }

  // ── 執行：AI 撰寫工作台 ─────────────────────────────────────

  /**
   * 這次執行**真的**用到的東西。
   *
   * 不是一份行銷清單 —— 每一項都對應到 prompt 裡真的會出現的一段：
   * 領域包的法遵知識（`withDomain`）、撰寫角色的全域指令與風格樣本、
   * 每節的覆寫 prompt、以及實際打的模型。使用者要判斷產出好不好，
   * 第一個要知道的就是它憑什麼那樣寫。
   */
  function skillsInPlay(): string[] {
    const st = store.get();
    const p = activeProject();
    const pack = domainPacks()[p?.domain || "generic"];
    const w = store.activeWriting();
    const perSection = Object.values(w.sectionPrompts ?? {}).filter((x) => x?.trim()).length;
    const out = [`模型 ${st.settings.model}`, `領域包 ${pack?.displayName ?? p?.domain ?? "通用"}`];
    if (store.activeDomainPrompt().trim()) out.push("領域法遵知識");
    if (w.globalInstruction.trim()) out.push("撰寫角色（全域指令）");
    if (w.styleSample.trim()) out.push("風格樣本");
    if (perSection) out.push(`逐節覆寫 ${perSection} 節`);
    return out;
  }

  /**
   * 跑一次 AI 撰寫。`instruction` 是提問引導的問答稿或資料夾摘要；
   * 沒給就是純粹依章節骨架寫。
   *
   * 全程在工作台視窗裡逐字播。**產出仍然只進草稿** —— 視窗的三個出口才決定
   * 它的去向：存檔寫進正文、暫存留在草稿、取消還原成執行前的樣子。
   */
  // ── 撰寫前的選擇 ────────────────────────────────────────────

  /** 這一節有沒有已儲存的正文。草稿不算 —— 草稿是「AI 寫了你還沒收下」 */
  function sectionHasContent(sec: Section): boolean {
    const saved = store.get().sectionValues[sec.id] ?? {};
    return Object.values(saved).some((v) => String(v).trim().length > 0);
  }

  let snapState = NO_SNAPSHOT;
  /**
   * 快照落後判定要用的 commit 時間。開面板時取一次 ——
   * 這一頁本來沒有專案統計，為了一個數字常駐輪詢不值得。
   */
  async function commitTimes(root: string | undefined): Promise<string[]> {
    if (!root || !isDesktop()) return [];
    try {
      const s = await requestProjectStats(root);
      return (s.git?.commits ?? []).map((c: { at: string }) => c.at);
    } catch {
      return [];
    }
  }

  /**
   * 撰寫前的選擇面板。
   *
   * 兩件事在這裡決定，因為它們都會影響「寫出來的東西對不對」：
   *
   * 1. **快照** —— 既有專案沒讀過資料夾就不給寫。模型手上只有章節骨架時，
   *    它會很流暢地寫出一份跟這個專案沒有關係的 PRD。
   * 2. **要寫哪幾節** —— 取代原本的「已有內容自動略過」。自動略過看起來
   *    貼心，但它替使用者做了決定：想重寫某一節的人得先去把它清空。
   *    已有內容的章節標出來、預設不勾，勾了才問要不要覆寫。
   */
  async function openWritePlan(): Promise<{ list: Section[]; brief: string } | null> {
    const back = document.getElementById("aiw-plan");
    if (!back) return null;
    const p = store.get().projects.find((x) => x.id === store.get().activeProjectId);
    const root = p?.importSummary?.rootPath;
    const all = sections();
    const chosen = new Set(all.filter((s) => !sectionHasContent(s)).map((s) => s.id));

    const line = document.getElementById("awp-snap-line")!;
    const scanBtn = document.getElementById("awp-scan") as HTMLButtonElement;
    const qa = document.getElementById("awp-qa")!;
    const goBtn = document.getElementById("awp-go") as HTMLButtonElement;
    const listEl = document.getElementById("awp-list")!;
    const countEl = document.getElementById("awp-count")!;

    const paintSnap = () => {
      line.textContent = snapshotLine(snapState, snapState.at ? sinceLabel(snapState.at.toISOString(), Date.now()) : "");
      line.className = `awp-snap-line${!snapState.required ? "" : !snapState.at ? " is-block" : snapState.stale?.stale ? " is-stale" : ""}`;
      scanBtn.hidden = !snapState.required || snapState.unavailable;
      qa.hidden = snapState.required;
      paintCount();
    };
    const paintCount = () => {
      const blocked = snapState.required && !snapState.unavailable && !snapState.at;
      countEl.textContent = blocked ? "先讀過資料夾才能撰寫" : `已選 ${chosen.size} / ${all.length} 節`;
      goBtn.disabled = blocked || chosen.size === 0;
    };

    const paintList = () => {
      listEl.innerHTML = all
        .map((sec) => {
          const filled = sectionHasContent(sec);
          return `<li class="awp-item${filled ? " has-content" : ""}">
            <label>
              <input type="checkbox" data-sec="${escapeHtml(sec.id)}"${chosen.has(sec.id) ? " checked" : ""} />
              <span class="awp-n">${escapeHtml(sec.n)}</span>
              <span class="awp-t">${escapeHtml(sec.title)}</span>
            </label>
            ${filled ? `<span class="awp-flag">已有內容</span>` : ""}
          </li>`;
        })
        .join("");
      listEl.querySelectorAll<HTMLInputElement>("[data-sec]").forEach((cb) => {
        cb.onchange = () => {
          const sec = all.find((x) => x.id === cb.dataset.sec)!;
          if (cb.checked && sectionHasContent(sec)) {
            // 勾了已有內容的章節就問一次 —— 覆寫掉的是使用者自己寫的東西
            if (!confirm(`「${sec.n} ${sec.title}」已經有內容。要讓 AI 覆寫嗎？`)) {
              cb.checked = false;
              return;
            }
          }
          cb.checked ? chosen.add(sec.id) : chosen.delete(sec.id);
          paintCount();
        };
      });
      paintCount();
    };

    const commits = await commitTimes(root);
    snapState = await readSnapshotState(root, commits);
    paintSnap();
    paintList();
    openModal("aiw-plan");

    return new Promise((resolve) => {
      const done = (v: { list: Section[]; brief: string } | null) => {
        closeModal("aiw-plan");
        resolve(v);
      };
      document.getElementById("awp-close")!.onclick = () => done(null);
      document.getElementById("awp-cancel")!.onclick = () => done(null);
      document.getElementById("awp-all")!.onclick = () => {
        // 全選會包含已有內容的章節，所以整批問一次而不是逐節問
        const filled = all.filter(sectionHasContent);
        if (filled.length && !confirm(`其中 ${filled.length} 節已經有內容，要一起覆寫嗎？`)) {
          all.filter((s) => !sectionHasContent(s)).forEach((s) => chosen.add(s.id));
        } else {
          all.forEach((s) => chosen.add(s.id));
        }
        paintList();
      };
      document.getElementById("awp-none")!.onclick = () => {
        chosen.clear();
        paintList();
      };
      scanBtn.onclick = async () => {
        if (!root) return;
        scanBtn.disabled = true;
        line.textContent = "讀取中…";
        const r = await makeSnapshot(root, projectDisplayName(p!));
        if (!r.ok) {
          line.textContent = r.reason;
        } else {
          toast(r.truncated ? `已讀 ${r.files} 個檔（有上限，未讀完）` : `已讀 ${r.files} 個檔`);
          snapState = await readSnapshotState(root, commits);
        }
        scanBtn.disabled = false;
        paintSnap();
      };
      document.getElementById("awp-go")!.onclick = () => {
        const brief = (document.getElementById("awp-brief") as HTMLTextAreaElement | null)?.value.trim() ?? "";
        done({ list: all.filter((s) => chosen.has(s.id)), brief });
      };
    });
  }

  /** 先開前置面板，選完才真的跑。取消就什麼都不做。 */
  async function startWrite(instruction?: string) {
    const plan = await openWritePlan();
    if (!plan) return;
    await runWrite({ instruction, only: plan.list, brief: plan.brief });
  }

  async function runWrite(opts: { instruction?: string; overwriteFilled?: boolean; only?: Section[]; brief?: string } = {}) {
    if (!editable()) return void toast("目前身分無法編輯內文");
    const ready = getAiReadiness();
    if (!ready.ok) return void toast(ready.reason);
    const list = opts.only ?? sections();
    if (!list.length) return void toast("這個領域沒有可寫的章節");

    // 執行前的草稿快照。「取消」要還原成這個樣子，而不是把草稿全部清掉 ——
    // 使用者在按下 AI 撰寫之前可能已經有自己手寫的草稿。
    const pid = store.get().activeProjectId;
    const before = snapshotDrafts(store.get().prdDrafts[pid]);
    const touched: TouchedField[] = [];

    // 快照當背景。既有專案在前置面板已經擋過「沒有快照」，這裡只負責取用
    const root = store.get().projects.find((x) => x.id === pid)?.importSummary?.rootPath;
    let snapContext = "";
    if (root && snapState.name) {
      const raw = await readSnapshotText(root, snapState.name);
      if (raw) {
        const c = clampForContext(raw);
        snapContext = `專案快照（${snapState.name}）：\n${c.text}`;
        if (c.clamped) toast("快照較長，只送出前段給模型");
      }
    } else if (opts.brief) {
      snapContext = `使用者說明：\n${opts.brief}`;
    }

    abort = new AbortController();

    // 還原的算法在 `draft-snapshot.ts`，有單元測試 —— 這是整條流程裡唯一
    // 會弄丟使用者東西的地方，不能只靠「在畫面上點一次沒事」當驗證
    const restore = () => {
      for (const op of restorePlan(before, touched)) {
        store.setSectionDraft(
          op.sectionId,
          op.key,
          op.value ?? store.sectionFieldSaved(op.sectionId, op.key),
        );
      }
    };

    const con = openWriteConsole({
      title: "AI 撰寫",
      // 使用者已經在前置面板逐節決定過，這裡不再自作主張略過
      subtitle: `${list.length} 節 · 你選的那幾節`,
      skills: skillsInPlay(),
      onStop: () => {
        abort?.abort();
        con.line("note", "已送出停止 —— 目前這一節寫完就會收手。");
      },
      onChat: async (msg) => {
        const sys = `You are helping a PM review an in-progress PRD draft.
Answer in ${store.get().settings.language === "en-US" ? "English" : "Traditional Chinese"}.
Be concrete and short. If the user asks for a change, say exactly which sections and fields it affects.
Do not claim you have modified anything — you cannot write here, the user re-runs the draft to apply changes.`;
        const ctx = list
          .map((sec) => `## ${sec.n} ${sec.title}\n${Object.values(valuesFor(sec)).join("\n").slice(0, 600)}`)
          .join("\n\n");
        return await chatCompletion(sys, `目前草稿：\n${ctx}\n\n使用者：${msg}`);
      },
      onSave: () => {
        const r = store.saveSections();
        toast(r.saved ? `已存檔 ${r.saved} 節` : "沒有可存的變更");
        render();
        return true;
      },
      onStash: () => {
        toast("已留在草稿 —— 到編輯台可以看到改了哪幾個字");
        render();
        return true;
      },
      onCancel: () => {
        abort?.abort();
        restore();
        toast(touched.length ? "已丟棄這次產出" : "已取消");
        render();
        return true;
      },
    });

    con.line("plan", `準備寫 ${list.length} 節：${list.map((x) => x.n).join("、")}`);
    if (opts.instruction) {
      con.line("plan", `額外指示（${opts.instruction.length} 字）會併進每一節的 prompt。`);
    }
    con.line(
      "note",
      "下面標「模型輸出」的是模型實際送回來的位元組。這個供應商不回傳獨立的推理串流，所以這裡不會有一段「思考中」的內心戲 —— 有的話那是編的。",
    );

    try {
      const res = await writeFullPrd(list, valuesFor, {
        instruction: [opts.instruction, snapContext].filter(Boolean).join("\n\n") || undefined,
        // 勾了就是要寫 —— 略過的判斷已經在前置面板做過，這裡再判一次會推翻使用者
        overwriteFilled: true,
        signal: abort.signal,
        onDelta: (chunk) => con.delta(chunk),
        onProgress: (p) => {
          const tag = `${p.section.n} ${p.section.title}`;
          if (p.phase === "start") {
            con.endStream();
            con.line("step", `${tag}（${p.index}/${p.total}）`);
          } else if (p.phase === "done") {
            con.endStream();
            const keys = Object.keys(p.patch ?? {});
            for (const [key, value] of Object.entries(p.patch ?? {})) {
              touched.push({ sectionId: p.section.id, key });
              store.setSectionDraft(p.section.id, key, value);
            }
            con.line("ok", `${tag} —— 寫了 ${keys.length} 欄：${keys.join("、")}`);
          } else if (p.phase === "skipped") {
            con.line("skip", `${tag} 已有內容，略過`);
          } else {
            con.endStream();
            con.line("fail", `${tag}：${p.error ?? "失敗"}`);
          }
        },
      });

      const parts = [`寫了 ${res.written} 節`];
      if (res.skipped) parts.push(`略過 ${res.skipped} 節`);
      if (res.failed) parts.push(`${res.failed} 節失敗`);
      con.line("plan", `${parts.join("·")}。內容都在草稿裡，還沒寫進正文。`);
      con.line("note", "存檔＝寫進正文；暫存＝留在草稿等你逐節看；取消＝還原成執行前的樣子。");
    } catch (e) {
      con.endStream();
      con.line("fail", e instanceof Error ? e.message : "AI 撰寫失敗");
    } finally {
      abort = null;
      con.finish();
      render();
    }
  }

  // ── Dashboard：三張卡 ───────────────────────────────────────

  /**
   * 模板資訊改成一列 chip，因為它跟「還缺什麼」是同一張卡的上下文：
   * 建議之所以是這幾條，正是因為套的是這個模板。分成兩張卡的時候，
   * 讀的人得自己把「7 章 / 9 條規則」跟下面那份清單接起來。
   */
  function templateStripHtml(p: Project): string {
    const name = p.domain || "generic";
    const pack = domainPacks()[name];
    const spec = store.activeGateSpec();
    const ruleCount = (spec.groups ?? []).reduce((n, g) => n + (g.rules?.length ?? 0), 0);
    const role = store.activeWriting().globalInstruction.trim() ? "已自訂" : "預設";
    return `<p class="aiw-kicker">適用模板</p>
      <h2 class="aiw-card-title">${escapeHtml(pack?.displayName ?? name)}
        <span class="aiw-card-title-sub">${escapeHtml(pack?.industry ? `${pack.industry} · ${name}` : name)}</span></h2>
      <ul class="aiw-chips">
        <li><span>章節</span><b>${sections().length}</b></li>
        <li><span>結構 gate 規則</span><b>${ruleCount}</b></li>
        <li><span>撰寫角色</span><b>${escapeHtml(role)}</b></li>
        <li class="aiw-chips-link"><a href="editor.html">在編輯台切換領域 →</a></li>
      </ul>`;
  }

  // ── 逐章狀態：整頁共用的一次計算 ────────────────────────────

  /**
   * 一節的狀態。刻意不發明分數：
   *
   *   pct  = 已填欄位／全部欄位（客觀，沒有判斷成分）
   *   規則 = 這一節跑 `runSectionCoach` 的結果（app 自己的判斷）
   *
   * 為什麼不用 `liveScore`：它從 `section.score` 出發，而那個欄位只有種子範例
   * 填過，真實專案永遠是 0，整張卡會是一排零。
   * 為什麼不用 `critiqueSectionLocal.score`：它的基底分只看字數、再逐條扣警告，
   * 結果是**空章節 48 分、寫了幾行的章節 41 分** —— 一個會獎勵空白的分數，
   * 放在鼓勵人寫下去的頁面上是反效果。
   */
  type Stage = {
    s: Section;
    pct: number;
    /** 還沒填的欄位數 —— 進度膠囊的時間估算基底 */
    missing: number;
    warn: number;
    block: number;
    /** 一個字都沒動過。ADHD／RSD：未起步不是失敗，不能畫成紅叉 */
    untouched: boolean;
    firstIssue: string;
  };

  function stagesOf(): Stage[] {
    const spec = store.activeGateSpec();
    return sections().map((s) => {
      const values = valuesFor(s);
      const filled = s.fields.filter((f) => (values[f.key] ?? "").trim()).length;
      const found = runSectionCoach({ sectionValues: { [s.id]: values }, sectionStatuses: [] }, spec, s.id);
      const bad = found.filter((f) => f.level !== "pass");
      return {
        s,
        pct: Math.round((filled / Math.max(1, s.fields.length)) * 100),
        missing: s.fields.length - filled,
        warn: found.filter((f) => f.level === "warn").length,
        block: found.filter((f) => f.level === "block").length,
        untouched: filled === 0,
        firstIssue: bad[0]?.label ?? "",
      };
    });
  }

  /**
   * 現在該碰哪一節 —— **永遠只回一個**。
   *
   * 回陣列的那一刻畫面就會忍不住把它們全列出來（`focus-card.ts` 的同一條教訓）。
   * 優先序：擋送審的 → 寫了一半的 → 還沒開始的。已經全好就回 null。
   */
  function pickFocusStage(stages: Stage[]): Stage | null {
    return (
      stages.find((x) => x.block) ??
      stages.find((x) => x.pct > 0 && x.pct < 100) ??
      stages.find((x) => x.untouched) ??
      null
    );
  }

  /**
   * 頭條卡。整頁**唯一**有顏色、有主要按鈕的東西。
   *
   * 沿用專案總覽的 `.ov-hero` 視覺（小標 → 大字 → 量表 → 為什麼 → CTA → 事實列），
   * 不另做一套：同一個人在兩頁之間切換，第二套版型就是第二次學習成本。
   *
   * 事實列封頂 4 個（`FOCUS_FIELD_CAP` 的同一條規矩），其中「約 N 分」是
   * 時間盲對策 —— 原本這一頁零時間資訊。
   */
  function heroHtml(stages: Stage[]): string {
    const gate = evaluatePrdGates(store.get(), store.activeGateSpec());
    const done = stages.filter((x) => x.pct === 100).length;
    const missing = stages.reduce((a, x) => a + x.missing, 0);
    const mins = Math.max(1, Math.round((missing * DEFAULT_TARGET) / CHARS_PER_MIN));
    const focus = pickFocusStage(stages);

    const facts = [
      { dt: "已填完", dd: `${done}/${stages.length} 節` },
      { dt: "還差", dd: missing ? `${missing} 個欄位` : "沒有空欄位" },
      { dt: "估計", dd: missing ? `約 ${mins} 分` : "—" },
      { dt: "結構 gate", dd: `${gate.score} 分` },
    ];
    const factsHtml = `<dl class="ov-hero-facts">${facts
      .map((f) => `<div><dt>${escapeHtml(f.dt)}</dt><dd>${escapeHtml(f.dd)}</dd></div>`)
      .join("")}</dl>`;

    if (!focus) {
      return `<section class="ov-hero aiw-hero" data-od-id="aiw-hero">
        <p class="ov-hero-kicker">現在做這一件</p>
        <h2 class="ov-hero-name">${gate.canSubmit ? "都填完了，可以送出審閱" : "章節填完了，還有結構問題要修"}</h2>
        <div class="ov-meter meter-ok" role="img" aria-label="完成度 100%">
          <div class="ov-meter-track"><i style="width:100%"></i></div>
          <span class="ov-meter-value">100<span class="ov-meter-unit">%</span></span>
        </div>
        <p class="ov-hero-why">${
          gate.canSubmit
            ? "七節都有內容，結構 gate 也過了。"
            : escapeHtml(`${gateSummaryLine(gate)} —— 展開下面的「改善與修復建議」逐條處理。`)
        }</p>
        <p class="ov-hero-cta"><a class="btn btn-primary btn-lg" href="review.html">送出審閱 →</a></p>
        ${factsHtml}
      </section>`;
    }

    const f = focus;
    const kind = f.block ? "block" : f.untouched ? "empty" : "partial";
    const why =
      kind === "block"
        ? `${f.firstIssue}。這一項擋住送審，先處理它。`
        : kind === "empty"
          ? "這一節還沒開始寫。空白頁最難起頭，讓 AI 先給一版再改。"
          : `還差 ${f.missing} 個欄位沒填${f.firstIssue ? `，而且「${f.firstIssue}」` : ""}。`;
    const cta =
      kind === "empty"
        ? `<button type="button" class="btn btn-primary btn-lg" id="btn-aiw-hero-write">AI 撰寫空章節 →</button>`
        : `<button type="button" class="btn btn-primary btn-lg" data-aiw-opt="${escapeHtml(f.s.id)}">AI 優化這一節 →</button>`;

    return `<section class="ov-hero aiw-hero" data-od-id="aiw-hero">
      <p class="ov-hero-kicker">現在做這一件</p>
      <h2 class="ov-hero-name">${escapeHtml(`${f.s.n} ${f.s.title}`)}</h2>
      <div class="ov-meter meter-${f.block ? "warn" : "go"}" role="img" aria-label="這一節完成度 ${f.pct}%">
        <div class="ov-meter-track"><i style="width:${f.pct}%"></i></div>
        <span class="ov-meter-value">${f.pct}<span class="ov-meter-unit">%</span></span>
      </div>
      <p class="ov-hero-why">${escapeHtml(why)}</p>
      <p class="ov-hero-cta">${cta}
        <a class="btn btn-ghost aiw-hero-alt" href="editor.html">自己寫</a></p>
      ${factsHtml}
    </section>`;
  }

  /**
   * 章節進度清單。頭條之外的一切都刻意**安靜**。
   *
   * 三個 ADHD 取捨，都是從原本的版本改回來的：
   * 1. **未起步不畫紅。** 原本 0% 走 `t-low`，七節裡三節是紅的，等於一進頁面
   *    就先被指著三個還沒做過的東西罵一次（`gate-rules.ts` 的 RSD 註解同一條）。
   * 2. **一列只留一個記號。** 原本每列 ✓／!／✗ 三個數字 × 七列＝ 21 個資訊點，
   *    現在只留最嚴重的那一個，乾淨的就什麼都不畫。
   * 3. **圖例砍掉。** 兩行「長條是…右邊是…」擺在資料上面，是每次進頁面都要
   *    重讀一次的稅。改成表頭的 title。
   */
  function stagesCardHtml(stages: Stage[]): string {
    const focus = pickFocusStage(stages);
    const done = stages.filter((x) => x.pct === 100).length;

    const rows = stages.map((x) => {
      const isFocus = focus?.s.id === x.s.id;
      const clean = !x.block && !x.warn;
      // 綠色只保留給「填滿而且規則全過」。100% 填滿卻掛著 ✗ 的綠條是自相矛盾的
      // 訊號：一眼看是好的，細看才發現不是。綠＝沒事，是這份清單唯一的約定。
      const tone = x.untouched ? "idle" : x.pct === 100 && clean ? "ok" : "go";
      // 未起步不掛任何記號 —— 對一個字都沒寫過的章節提出警告，是在罵一件
      // 還沒發生的事（gate-rules.ts 的 RSD 註解同一條）。
      const mark = x.untouched
        ? ""
        : x.block
          ? `<span class="aiw-mark is-block" title="${escapeHtml(x.firstIssue)}">✗${x.block}</span>`
          : x.warn
            ? `<span class="aiw-mark is-warn" title="${escapeHtml(x.firstIssue)}">!${x.warn}</span>`
            : x.pct === 100
              ? `<span class="aiw-mark is-ok">✓</span>`
              : "";
      // **只有「已填滿」才反灰。**
      // 之前未設金鑰／無編輯權限也一起 disabled，結果是七顆按鈕全部點了沒反應，
      // 而理由只寫在 title —— 沒有人會為了一顆看起來壞掉的按鈕去 hover 它。
      // 那兩種情況改成照樣可按，由工作台開場就把理由講出來（它本來就有那一步）。
      const why = x.pct === 100 ? "這一節欄位已經填滿" : "";
      return `<li class="aiw-score-row${isFocus ? " is-focus" : ""}">
        <span class="aiw-score-n mono">${escapeHtml(x.s.n)}</span>
        <span class="aiw-score-title">${escapeHtml(x.s.title)}</span>
        <span class="aiw-bar tone-${tone}"><i style="width:${x.pct}%"></i></span>
        <span class="aiw-score-num mono tone-${tone}">${x.untouched ? "未開始" : `${x.pct}%`}</span>
        <span class="aiw-score-checks">${mark}</span>
        <button type="button" class="btn btn-sm btn-ghost aiw-opt-btn" data-aiw-opt="${escapeHtml(x.s.id)}"
                ${why ? `disabled title="${escapeHtml(why)}"` : ""}>AI 優化</button>
      </li>`;
    });

    return `<section class="card aiw-card aiw-stages-card" data-od-id="aiw-scores">
      <div class="aiw-stage-head">
        <p class="aiw-kicker">章節進度</p>
        <span class="aiw-stage-count mono"
              title="長條＝這一節填了幾成欄位；右邊記號＝跑過規則後最嚴重的那一項">${done}/${stages.length} 節填完</span>
      </div>
      <ul class="aiw-score-list">${rows.join("")}</ul>
    </section>`;
  }

  /**
   * 簽核狀態。跟頭條並排，**寬度只給三分之一**。
   *
   * 它是「別人現在做到哪」，跟頭條的「你現在做什麼」是兩件事，但同時要看得到 ——
   * 摺起來的話，審到一半的案子每次都要多按一下才知道卡在誰身上。
   * 給三分之一寬而不是一半：關卡列是短標籤，等寬只會多出一片空白，
   * 而且視覺重量對半分就沒有頭條了。
   */
  function signoffHtml(p: Project): string {
    const c = store.get().cases[p.id];
    if (!c || !c.stages.length) {
      return `<section class="card aiw-card aiw-signoff" data-od-id="aiw-signoff">
        <p class="aiw-kicker">簽核狀態</p>
        <h2 class="aiw-card-title">尚未送審</h2>
        <p class="aiw-card-sub">送出審閱之後這裡才會有關卡。</p>
        <p class="aiw-card-link"><a href="review.html">審閱佇列 →</a></p>
      </section>`;
    }
    const label: Record<string, string> = {
      approved: "已核准",
      pending: "待簽核",
      empty: "未指派",
      skipped: "略過",
    };
    const done = c.stages.filter((s) => s.state === "approved").length;
    const live = Boolean(c.reviewCommitId) && !c.withdrawn;
    const state = c.withdrawn
      ? `已抽單${c.withdrawReason ? `：${c.withdrawReason}` : ""}`
      : c.locked
        ? "已鎖定"
        : live
          ? "審閱中"
          : "尚未送審";
    const rows = c.stages
      .map(
        (s) => `<li class="aiw-stage aiw-stage--${s.state}">
          <span class="aiw-stage-name">${escapeHtml(s.name)}</span>
          <span class="aiw-stage-who">${escapeHtml(s.assigneeName || "待指派")}</span>
          <span class="pill">${escapeHtml(label[s.state] ?? s.state)}</span>
        </li>`,
      )
      .join("");
    return `<section class="card aiw-card aiw-signoff" data-od-id="aiw-signoff">
      <p class="aiw-kicker">簽核狀態</p>
      <h2 class="aiw-card-title">${done}/${c.stages.length} 關已核准</h2>
      <p class="aiw-card-sub">${escapeHtml(live ? `${state}，比對送審當下那份快照` : state)}</p>
      <ul class="aiw-stages">${rows}</ul>
    </section>`;
  }

  /**
   * 適用模板 ＋ 改善與修復建議（同一張卡）。
   *
   * 結構 gate 的 block／warn 排在前面（那是擋送審的東西），逐章未過的檢查排後面。
   * 每一條都要能直接點去修 —— 只列問題不給去處的清單，等於把找路的成本丟回來。
   */
  function fixCardHtml(p: Project): string {
    const gate = evaluatePrdGates(store.get(), store.activeGateSpec());
    const rows: string[] = [];

    for (const f of gate.findings) {
      if (f.level === "pass") continue;
      rows.push(`<li class="aiw-fix aiw-fix--${f.untouched ? "todo" : f.level}">
        <span class="aiw-fix-tag">${f.untouched ? "未開始" : f.level === "block" ? "BLOCK" : "WARN"}</span>
        <span class="aiw-fix-body"><b>${escapeHtml(f.label)}</b>
          <span class="aiw-fix-detail">${escapeHtml(f.untouched ? "這一項還沒開始寫" : f.detail)}</span></span>
      </li>`);
    }

    for (const s of sections()) {
      const failing = evaluateChecks(s, valuesFor(s)).filter((c) => !c.pass);
      if (!failing.length) continue;
      rows.push(`<li class="aiw-fix aiw-fix--check">
        <span class="aiw-fix-tag">${escapeHtml(s.n)}</span>
        <span class="aiw-fix-body"><b>${escapeHtml(s.title)}</b>
          <span class="aiw-fix-detail">${escapeHtml(failing.map((c) => c.label).join("、"))}</span></span>
        <a class="aiw-fix-go" href="editor.html">去修 →</a>
      </li>`);
    }

    // 跟章節進度並排。高度由右邊那張決定，這一張超出就自己捲 ——
    // 建議條數會隨專案變動，讓它撐高整列的話，兩張卡永遠對不齊。
    return `<section class="card aiw-card aiw-fixes" data-od-id="aiw-fixes">
      <div class="aiw-stage-head">
        <p class="aiw-kicker">改善與修復建議</p>
        <span class="aiw-stage-count mono">${rows.length ? `${rows.length} 項待處理` : "都過了"}</span>
      </div>
      ${templateStripHtml(p)}
      <hr class="aiw-rule" />
      <p class="aiw-card-sub">${
        rows.length
          ? "按「AI 撰寫」會針對空章節補稿；已有內容的章節不會被蓋掉。"
          : "結構 gate 與逐章檢查都過了，可以送出審閱。"
      }</p>
      ${rows.length ? `<ul class="aiw-fix-list aiw-fix-scroll">${rows.join("")}</ul>` : ""}
    </section>`;
  }

  /**
   * 版面順序就是 ADHD 的優先序：
   *
   *   1. 頭條 —— 唯一有顏色、有主要按鈕的東西，回答「現在做什麼」
   *   2. 章節進度 —— 安靜、可掃視，回答「還剩什麼」
   *   3. 兩塊摺疊 —— 回答「細節是什麼」，要看才展開
   *
   * 同框開放迴圈從原本的 4 張卡 ＋ 7 顆按鈕 ＋ 21 個狀態數字，
   * 降到 1 個頭條 ＋ 1 份清單 ＋ 2 個摺疊標題。
   */
  function dashboardHtml(p: Project): string {
    const stages = stagesOf();
    return `<div class="aiw-top">
        ${heroHtml(stages)}
        ${signoffHtml(p)}
      </div>
      <div class="aiw-mid">
        ${fixCardHtml(p)}
        ${stagesCardHtml(stages)}
      </div>`;
  }

  // ── 創建引導 ────────────────────────────────────────────────

  function interviewHtml(): string {
    if (!interview) return "";
    const done = interview.turns.filter((t) => t.answer.trim());
    const history = done.length
      ? `<ol class="aiw-qa">${done
          .map(
            (t) => `<li><b>${escapeHtml(t.question)}</b><span>${escapeHtml(t.answer)}</span></li>`,
          )
          .join("")}</ol>`
      : "";

    if (interview.finished) {
      return `<section class="card aiw-card aiw-card--wide" data-od-id="aiw-interview">
        <p class="aiw-kicker">AI 提問引導撰寫</p>
        <h2 class="aiw-card-title">問完了，可以開始寫</h2>
        <p class="aiw-card-sub">${escapeHtml(interview.why || "資訊已足夠")}</p>
        ${history}
        <div class="aiw-actions">
          <button type="button" class="btn btn-primary" id="btn-aiw-iv-write">依這些回答產出全文</button>
          <button type="button" class="btn btn-ghost" id="btn-aiw-iv-cancel">取消</button>
        </div>
      </section>`;
    }

    return `<section class="card aiw-card aiw-card--wide" data-od-id="aiw-interview">
      <p class="aiw-kicker">AI 提問引導撰寫<span class="aiw-step">第 ${done.length + 1} 題 / 最多 ${MAX_INTERVIEW_TURNS}</span></p>
      <h2 class="aiw-card-title">${
        interview.busy ? "想下一題中…" : escapeHtml(interview.question ?? "")
      }</h2>
      ${interview.why && !interview.busy ? `<p class="aiw-card-sub">${escapeHtml(interview.why)}</p>` : ""}
      ${history}
      <textarea id="aiw-answer" class="aiw-answer" rows="4"
                placeholder="一到三句話就好。不知道就按「這題跳過」。"
                ${interview.busy ? "disabled" : ""}></textarea>
      <div class="aiw-actions">
        <button type="button" class="btn btn-primary" id="btn-aiw-iv-next" ${interview.busy ? "disabled" : ""}>下一題</button>
        <button type="button" class="btn" id="btn-aiw-iv-skip" ${interview.busy ? "disabled" : ""}>這題跳過</button>
        <button type="button" class="btn btn-ghost" id="btn-aiw-iv-stop" ${interview.busy ? "disabled" : ""}>問夠了，直接寫</button>
      </div>
    </section>`;
  }

  function folderHtml(): string {
    if (!folder) return "";
    const c = folder.candidate;
    const slots = c.slots
      .filter((s) => s.match)
      .map(
        (s) => `<li class="aiw-slot aiw-slot--${s.status}">
          <span>${escapeHtml(SLOT_META[s.slot].label)}</span>
          <span class="mono">${escapeHtml(s.match!.file.path)}</span>
          <span class="pill">${s.match!.contentScore}</span>
        </li>`,
      )
      .join("");
    return `<section class="card aiw-card aiw-card--wide" data-od-id="aiw-folder">
      <p class="aiw-kicker">讀取專案資料夾</p>
      <h2 class="aiw-card-title">${escapeHtml(folder.name)} · 讀到 ${c.files.length} 份文件</h2>
      <p class="aiw-card-sub">必要文件覆蓋 ${c.coveragePct}% · 內容總分 ${c.overallScore}</p>
      <ul class="aiw-slots">${slots || `<li class="aiw-slot aiw-slot--missing">沒有對應到任何已知文件類型，仍會把全文當背景資料交給模型</li>`}</ul>
      <div class="aiw-actions">
        <button type="button" class="btn btn-primary" id="btn-aiw-folder-write">依資料夾內容產出全文</button>
        <button type="button" class="btn" id="btn-aiw-folder-again">換一個資料夾</button>
        <button type="button" class="btn btn-ghost" id="btn-aiw-folder-cancel">取消</button>
      </div>
    </section>`;
  }

  function guideHtml(): string {
    const ready = getAiReadiness();
    const blocked = ready.ok ? "" : ` disabled title="${escapeHtml(ready.reason)}"`;
    return `<div class="aiw-guide">
      <section class="card aiw-choice aiw-choice--ai" data-od-id="aiw-choice-ai">
        <p class="aiw-kicker">AI 撰寫</p>
        <h2 class="aiw-card-title">讓模型先寫出第一版</h2>
        <p class="aiw-card-sub">產出進草稿，你逐節看過再決定收不收。</p>
        <div class="aiw-subcards">
          <div class="aiw-subcard">
            <h3>AI 提問引導撰寫</h3>
            <p>一次問一題，最多 ${MAX_INTERVIEW_TURNS} 題。用你的答案當事實去寫，而不是靠章節標題猜。</p>
            <button type="button" class="btn btn-primary" id="btn-aiw-interview"${blocked}>開始問答</button>
          </div>
          <div class="aiw-subcard">
            <h3>讀取專案資料夾，自動產出全文</h3>
            <p>掃描既有的 README／spec／plans，先對應到章節，剩下的空章節由模型依這些內容補完。</p>
            <button type="button" class="btn btn-primary" id="btn-aiw-folder"${blocked}>選擇資料夾</button>
          </div>
        </div>
        ${ready.ok ? "" : `<p class="aiw-warn">${escapeHtml(ready.reason)}填好之後這兩個入口就會啟用。</p>`}
      </section>

      <section class="card aiw-choice aiw-choice--blank" data-od-id="aiw-choice-blank">
        <p class="aiw-kicker">建立空白範本</p>
        <h2 class="aiw-card-title">自己寫，我給骨架</h2>
        <p class="aiw-card-sub">把這個領域的每一節都放進填空骨架，直接進編輯台一格一格補。不呼叫模型。</p>
        <ul class="aiw-facts">
          <li><span>章節</span><b>${sections().length}</b></li>
          <li><span>會呼叫 API</span><b>否</b></li>
        </ul>
        <button type="button" class="btn" id="btn-aiw-blank">建立空白範本</button>
      </section>
    </div>`;
  }

  // ── 動作 ────────────────────────────────────────────────────

  async function askNext() {
    if (!interview) return;
    interview.busy = true;
    render();
    try {
      const q = await nextInterviewQuestion(sections(), interview.turns);
      if (!interview) return;
      interview.why = q.why;
      if (q.done) {
        interview.finished = true;
        interview.question = null;
      } else {
        interview.question = q.question;
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "提問失敗");
      interview = null;
    } finally {
      if (interview) interview.busy = false;
      render();
    }
  }

  function captureAnswer(answer: string) {
    if (!interview?.question) return;
    interview.turns.push({ question: interview.question, answer });
    interview.question = null;
  }

  /** 資料夾全文摘要：模型看得到原始文件，不只是被對應過的那幾欄 */
  function folderDigest(c: ProjectCandidate): string {
    const MAX = 12000;
    let out = "";
    for (const f of c.files) {
      const chunk = `\n\n--- ${f.path} ---\n${f.text.trim()}`;
      if (out.length + chunk.length > MAX) {
        out += `\n\n--- ${f.path} ---\n${f.text.trim().slice(0, Math.max(0, MAX - out.length))}`;
        break;
      }
      out += chunk;
    }
    return `以下是這個專案資料夾裡的既有文件，撰寫時以它們為事實來源，不要另外編造產品情境：${out}`;
  }

  async function writeFromFolder() {
    if (!folder) return;
    const c = folder.candidate;
    // 能被規則對應的先進草稿 —— 這一段不用花 API，而且比模型改寫更忠實
    const mapped = mapCandidateToSectionValues(c);
    const known = new Set(sections().map((s) => s.id));
    let prefilled = 0;
    for (const [sectionId, fields] of Object.entries(mapped)) {
      if (!known.has(sectionId)) continue;
      for (const [key, value] of Object.entries(fields)) {
        if (!value.trim()) continue;
        store.setSectionDraft(sectionId, key, value);
        prefilled++;
      }
    }
    if (prefilled) toast(`先對應了 ${prefilled} 個欄位，其餘交給模型`);
    const digest = folderDigest(c);
    folder = null;
    await startWrite(digest);
  }

  function scanFiles(files: FileList | null) {
    if (!files?.length) return void toast("沒有讀到任何檔案（App 內請用原生選夾）");
    toast("掃描資料夾中…");
    void scanFolderFromFileList(files, (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split("/")[0])
      .then((res) => {
        const c = res.candidates[0];
        if (!c) return void toast("這個資料夾裡沒有可讀的文字文件");
        folder = { candidate: c, name: res.folderName };
        render();
      })
      .catch((e) => toast(e instanceof Error ? e.message : "掃描失敗"));
  }

  function pickFolder() {
    if (!editable()) return void toast("目前身分無法編輯內文");
    if (isNative()) {
      toast("請在系統對話框選擇資料夾…");
      void native
        .pickFolder()
        .then((r) => {
          if (r.cancelled) return;
          const res = scanFromNativeFolder(r.folderName || "專案資料夾", r.files, r.folderPath ?? "");
          const c = res.candidates[0];
          if (!c) return void toast("這個資料夾裡沒有可讀的文字文件");
          folder = { candidate: c, name: res.folderName };
          render();
        })
        .catch(() => toast("無法開啟系統對話框，請重啟 App"));
      return;
    }
    const input = document.getElementById("aiw-folder-input") as HTMLInputElement | null;
    if (!input) return void toast("找不到檔案選擇器");
    input.value = "";
    input.click();
  }

  /** 建立空白範本：把每節的填空骨架寫成已儲存的正文，這份 PRD 就存在了 */
  function createBlank() {
    if (!editable()) return void toast("目前身分無法編輯內文");
    let n = 0;
    for (const s of sections()) {
      const field = s.fields.find((f) => f.type === "textarea") ?? s.fields[0];
      if (!field) continue;
      store.setSectionValues(s.id, { [field.key]: starterScaffold(s) });
      store.updateSection(s.id, { status: "empty" });
      n++;
    }
    toast(`已放進 ${n} 節的填空骨架`);
    window.setTimeout(() => (location.href = "editor.html"), 500);
  }

  // ── Render ──────────────────────────────────────────────────

  function render() {
    if (!root) return;
    const p = activeProject();
    syncChrome(p);

    if (!p) {
      root.innerHTML = `<section class="card aiw-card aiw-card--wide">
        <p class="aiw-kicker">PRD 審閱監控</p>
        <h2 class="aiw-card-title">還沒有專案</h2>
        <p class="aiw-card-sub">AI 撰寫是對著某一個專案做的事，先建一個再回來。</p>
        <p class="aiw-card-link"><a href="projects.html?new=1">新建專案 →</a></p>
      </section>`;
      return;
    }

    if (interview) root.innerHTML = interviewHtml();
    else if (folder) root.innerHTML = folderHtml();
    else if (hasPrd()) root.innerHTML = dashboardHtml(p);
    else root.innerHTML = guideHtml();

    bind();
  }

  function on(id: string, fn: () => void) {
    document.getElementById(id)?.addEventListener("click", fn);
  }

  function bind() {
    // 逐章「AI 優化」：事件委派在清單上，省掉每次重畫都掛 7 顆按鈕
    document.querySelectorAll<HTMLButtonElement>("[data-aiw-opt]").forEach((b) => {
      b.addEventListener("click", () => {
        const s = sections().find((x) => x.id === b.dataset.aiwOpt);
        if (!s) return;
        openOptimizeWorkbench({
          section: s,
          values: valuesFor(s),
          spec: store.activeGateSpec(),
          onApply: (patch) => {
            for (const [key, value] of Object.entries(patch)) {
              store.setSectionDraft(s.id, key, value);
            }
            render();
          },
        });
      });
    });

    on("btn-aiw-hero-write", () => void startWrite());

    on("btn-aiw-interview", () => {
      interview = { turns: [], question: null, why: "", busy: true, finished: false };
      render();
      void askNext();
    });
    on("btn-aiw-iv-next", () => {
      const ta = document.getElementById("aiw-answer") as HTMLTextAreaElement | null;
      const answer = ta?.value.trim() ?? "";
      if (!answer) return void toast("寫一句話，或按「這題跳過」");
      captureAnswer(answer);
      void askNext();
    });
    on("btn-aiw-iv-skip", () => {
      captureAnswer("");
      void askNext();
    });
    on("btn-aiw-iv-stop", () => {
      const ta = document.getElementById("aiw-answer") as HTMLTextAreaElement | null;
      if (ta?.value.trim()) captureAnswer(ta.value.trim());
      if (interview) {
        interview.finished = true;
        interview.question = null;
        interview.why = "你按了「問夠了」";
      }
      render();
    });
    on("btn-aiw-iv-write", () => {
      const instruction = interviewInstruction(interview?.turns ?? []);
      interview = null;
      void runWrite({ instruction, overwriteFilled: true });
    });
    on("btn-aiw-iv-cancel", () => {
      interview = null;
      render();
    });

    on("btn-aiw-folder", pickFolder);
    on("btn-aiw-folder-again", pickFolder);
    on("btn-aiw-folder-write", () => void writeFromFolder());
    on("btn-aiw-folder-cancel", () => {
      folder = null;
      render();
    });

    on("btn-aiw-blank", createBlank);
  }

  document.getElementById("btn-aiw-refresh")?.addEventListener("click", () => {
    store.refreshDomainPacks();
    render();
    toast("已重新整理");
  });
  document.getElementById("btn-aiw-write")?.addEventListener("click", () => void startWrite());
  document.getElementById("aiw-folder-input")?.addEventListener("change", (e) => {
    scanFiles((e.target as HTMLInputElement).files);
  });

  render();
}
