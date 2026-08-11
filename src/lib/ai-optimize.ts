/**
 * AI 優化工作台 —— 針對「單一章節」的四步修補流程。
 *
 *   1. 問一次：要不要先做 AI 診斷（先讓人看到掃描範圍，再決定花不花這次 API）
 *   2. 診斷：掃描本節已有內容，產出「建議修改方向」
 *   3. 方向可改：方向是一段**可編輯的文字**，使用者同意（或改寫）之後才動筆
 *   4. diff 再確認：產出的內容以 before → after 呈現，按了套用才進草稿
 *
 * 為什麼要拆成四步而不是一顆「幫我優化」：
 * 模型直接改寫整節是最快也最不可控的做法 —— 改了什麼、為什麼改、要不要留，
 * 三件事全部糊在一起。把「方向」單獨拿出來讓人改，是這條流程唯一真正的
 * 控制點；diff 則是最後一道，確保沒有任何一個字是在使用者沒看過的情況下落地。
 *
 * 這支只負責流程與畫面。「改完之後寫到哪裡」由呼叫端的 `onApply` 決定 ——
 * 在 AI 撰寫頁是寫進草稿，換個地方掛可以是別的去處。
 */
import type { Section } from "../data/types";
import { store } from "../data/store";
import { AiError, critiqueSectionWithAI, generateAIDraft, getAiReadiness } from "./ai-coach";
import { canEditContent } from "./permissions";
import type { AICritique } from "./ai-coach";
import { diffRowsHtml } from "./diff-summary";
import type { GateSpec } from "./gate-rules";
import { escapeHtml, toast } from "./ui";

const MODAL_ID = "ai-optimize-modal";

type Step = "ask" | "busy" | "directions" | "diff" | "error";

export type OptimizeOptions = {
  section: Section;
  /** 這一節現在的內容（已儲存疊上草稿），也是 diff 的 before */
  values: Record<string, string>;
  spec: GateSpec;
  /** 使用者按下「套用」時拿到的欄位 patch */
  onApply: (patch: Record<string, string>) => void;
};

/** 診斷結果 → 預填的方向文字。一行一條，讓人可以直接刪掉不同意的那幾行。 */
function directionsFrom(c: AICritique): string {
  const lines = [...c.warnings, ...c.suggestions]
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s, i, arr) => arr.indexOf(s) === i);
  return lines.map((l) => `- ${l.replace(/^[-・·\s]+/, "")}`).join("\n");
}

function fieldScopeHtml(section: Section, values: Record<string, string>): string {
  return `<ul class="aiopt-scope">${section.fields
    .map((f) => {
      const n = (values[f.key] ?? "").trim().length;
      return `<li class="${n ? "" : "is-empty"}">
        <span>${escapeHtml(f.label)}</span>
        <b class="mono">${n ? `${n} 字` : "空"}</b>
      </li>`;
    })
    .join("")}</ul>`;
}

export function openOptimizeWorkbench(opts: OptimizeOptions) {
  const { section, values, spec, onApply } = opts;

  let step: Step = "ask";
  let busyText = "";
  let errorText = "";
  /** 錯誤發生前在哪一步 —— 「重試」要回到那一步，不是回到最前面 */
  let retryFrom: Step = "ask";
  let critique: AICritique | null = null;
  let directions = "";
  let patch: Record<string, string> = {};
  /** 關掉之後仍在飛的請求要被丟掉，不能回頭改一個已經消失的畫面 */
  let closed = false;
  /** 權限擋下的：連「去設定」都沒有用，只能關掉 */
  let blocked = false;

  const back = document.createElement("div");
  back.className = "modal-back";
  back.id = MODAL_ID;
  back.innerHTML = `<div class="modal modal-optimize" role="dialog" aria-labelledby="aiopt-title">
    <header>
      <div>
        <h3 id="aiopt-title">AI 優化工作台</h3>
        <p class="sub">${escapeHtml(`${section.n} ${section.title}`)}</p>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-aiopt-close>關閉</button>
    </header>
    <div class="body aiopt-body"></div>
    <footer class="aiopt-foot"></footer>
  </div>`;
  document.body.appendChild(back);
  back.classList.add("open");

  const body = back.querySelector(".aiopt-body") as HTMLElement;
  const foot = back.querySelector(".aiopt-foot") as HTMLElement;

  function close() {
    closed = true;
    document.removeEventListener("keydown", onKey);
    back.remove();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", onKey);
  back.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    if (el === back || el.closest("[data-aiopt-close]")) close();
  });

  function btn(id: string, label: string, cls = "btn"): string {
    return `<button type="button" class="${cls}" data-aiopt-act="${id}">${escapeHtml(label)}</button>`;
  }

  function render() {
    if (closed) return;
    const model = store.get().settings.model;

    if (step === "ask") {
      body.innerHTML = `
        <p class="aiopt-lead">先做一次 <b>AI 診斷</b>嗎？會把這一節目前的內容送給 ${escapeHtml(model)} 掃描，
          列出建議的修改方向。<b>診斷不會改動任何內容</b> —— 方向你同意了才會動筆。</p>
        <p class="aiopt-sub">掃描範圍</p>
        ${fieldScopeHtml(section, values)}`;
      foot.innerHTML = btn("cancel", "取消", "btn btn-ghost") + btn("diagnose", "確認診斷", "btn btn-primary");
    } else if (step === "busy") {
      body.innerHTML = `<p class="aiopt-busy">${escapeHtml(busyText)}</p>`;
      foot.innerHTML = btn("cancel", "取消", "btn btn-ghost");
    } else if (step === "directions" && critique) {
      const c = critique;
      body.innerHTML = `
        <div class="aiopt-verdict">
          <strong>${escapeHtml(c.summary)}</strong>
          <span class="mono aiopt-grade">${c.score} · ${escapeHtml(c.grade)}${c.localOnly ? " · 僅本機規則" : ""}</span>
        </div>
        ${
          c.strengths.length
            ? `<p class="aiopt-sub">已經做到的</p><ul class="aiopt-strengths">${c.strengths
                .map((s) => `<li>${escapeHtml(s)}</li>`)
                .join("")}</ul>`
            : ""
        }
        <p class="aiopt-sub">建議修改方向 <span class="aiopt-hint">改成你要的樣子，或刪掉不同意的那幾行</span></p>
        <textarea id="aiopt-directions" class="aiopt-directions" rows="8"
                  aria-label="建議修改方向">${escapeHtml(directions)}</textarea>`;
      foot.innerHTML =
        btn("cancel", "取消", "btn btn-ghost") +
        btn("diagnose", "重新診斷") +
        btn("write", "同意方向，產生修改", "btn btn-primary");
    } else if (step === "diff") {
      const changed = section.fields
        .map((f) => ({ f, before: (values[f.key] ?? "").trim(), after: (patch[f.key] ?? "").trim() }))
        .filter((r) => r.after && r.after !== r.before);
      body.innerHTML = changed.length
        ? `<p class="aiopt-lead">模型改了 <b>${changed.length}</b> 個欄位。
             <span class="fv-add">藍字</span>是新增、<span class="fv-del">紅字刪除線</span>是拿掉的。
             按下套用之後內容會進<b>草稿</b>，還不是已儲存。</p>
           ${changed
             .map(
               (r) => `<div class="aiopt-diff">
                 <p class="aiopt-sub">${escapeHtml(r.f.label)}</p>
                 <div class="field-diff"><div class="field-diff-body">${diffRowsHtml(r.before, r.after) || `<span class="fv-line fv-changed"><span class="fv-add">${escapeHtml(r.after)}</span></span>`}</div></div>
               </div>`,
             )
             .join("")}`
        : `<p class="aiopt-lead">模型這次沒有提出任何實際改動。可以改一下方向再產生一次。</p>`;
      foot.innerHTML =
        btn("cancel", "取消", "btn btn-ghost") +
        btn("back", "改方向") +
        (changed.length ? btn("apply", "套用到草稿", "btn btn-primary") : "");
    } else if (step === "error") {
      // 未設定金鑰不是「錯誤」，是「還沒設定」—— 給去處，不要只給一句紅字。
      // 這一步同時是逐章按鈕的說明頁：按鈕不再因為未就緒而反灰，理由改在這裡講。
      const needsSetup = !blocked && !getAiReadiness().ok;
      body.innerHTML = `<p class="aiopt-err">${escapeHtml(errorText)}</p>${
        needsSetup
          ? `<p class="aiopt-lead">到「偏好設定 → AI 工具」填好金鑰，這一頁的 AI 功能就會全部啟用。</p>`
          : ""
      }`;
      foot.innerHTML =
        btn("cancel", "關閉", "btn btn-ghost") +
        (needsSetup
          ? `<a class="btn btn-primary" href="settings.html">去設定 API Key</a>`
          : blocked
            ? ""
            : btn("retry", "重試", "btn btn-primary"));
    }

    foot.querySelectorAll<HTMLButtonElement>("[data-aiopt-act]").forEach((b) => {
      b.addEventListener("click", () => act(b.dataset.aioptAct!));
    });
    (body.querySelector("textarea, button") as HTMLElement | null)?.focus();
  }

  function fail(e: unknown, from: Step) {
    if (closed) return;
    errorText = e instanceof AiError || e instanceof Error ? e.message : String(e);
    retryFrom = from;
    step = "error";
    render();
  }

  async function diagnose() {
    step = "busy";
    busyText = `正在掃描「${section.n} ${section.title}」的現有內容…`;
    render();
    try {
      const c = await critiqueSectionWithAI(section, values, store.get().settings, spec);
      if (closed) return;
      critique = c;
      directions = directionsFrom(c);
      step = "directions";
      render();
    } catch (e) {
      fail(e, "ask");
    }
  }

  async function write() {
    const ta = document.getElementById("aiopt-directions") as HTMLTextAreaElement | null;
    directions = ta?.value.trim() ?? directions;
    if (!directions) {
      toast("方向是空的 —— 至少留一條，模型才知道要改什麼");
      return;
    }
    step = "busy";
    busyText = `正在依你同意的方向改寫「${section.title}」…`;
    render();
    try {
      const prompt = `依照以下修改方向改寫本章節。只改方向點到的地方，其餘保留原文的意思與用詞：\n${directions}`;
      const p = await generateAIDraft(section, values, prompt);
      if (closed) return;
      patch = p;
      step = "diff";
      render();
    } catch (e) {
      fail(e, "directions");
    }
  }

  function act(id: string) {
    if (id === "cancel") return close();
    if (id === "diagnose") return void diagnose();
    if (id === "write") return void write();
    if (id === "back") {
      step = critique ? "directions" : "ask";
      render();
      return;
    }
    if (id === "retry") {
      if (retryFrom === "directions") return void write();
      return void diagnose();
    }
    if (id === "apply") {
      const n = Object.keys(patch).length;
      onApply(patch);
      close();
      toast(`已套用 ${n} 個欄位到草稿 —— 到編輯台確認後再儲存`);
    }
  }

  // 開場就把「為什麼不能做」講完，不要讓人走到第三步才撞牆。
  // 逐章按鈕不再因為這兩種情況反灰，理由一律在這裡出現。
  const ready = getAiReadiness();
  if (!canEditContent(store.get().currentUser)) {
    blocked = true;
    errorText = "目前身分無法編輯內文，所以不能套用 AI 的修改。";
    step = "error";
  } else if (!ready.ok) {
    errorText = ready.reason;
    step = "error";
  }
  render();
}
