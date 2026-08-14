/**
 * 設定頁的「UAT 報告格式」區塊。
 *
 * ## 這一塊在管什麼
 *
 * `~/.anchorline/uat-format.md` 一個檔。出題 skill 在出題前會讀它，所以這裡
 * 按下存檔就等於改了 agent 的出題規格 —— 中間沒有複製、沒有同步、沒有重啟。
 * 那不是這個功能做對了什麼，是它**刻意不做**任何複製的結果。
 *
 * ## 三條貫穿本檔的規矩
 *
 * 1. **內容沒變就不寫。** 每次寫入都會產生一份快照，讓「按了兩次存檔」在
 *    變更紀錄裡留下一個沒有任何差異的版本，等於把紀錄稀釋掉。
 * 2. **AI 不可用時按鈕就是灰的**，不是按下去假裝成功。這是 repo 的既有原則。
 * 3. **「還原預設」與「還原這一版」都只填回 textarea，不自動存。**
 *    還原是一個提議，存檔才是決定 —— 兩者之間那一眼是使用者唯一的煞車。
 *
 * 唯一自動存檔的路徑是 AI 套用：使用者已經在預覽畫面看過完整結果並按了套用，
 * 那一眼已經發生過了，再要求他按第二次只是多一個會忘記的步驟。
 */
import { store } from "../data/store";
import { chatCompletion, getAiReadiness } from "./ai-client";
import { isNative, isUnavailable, native } from "./native";
import { promptSystem, promptTemperature } from "./prompt-registry";
import { escapeHtml, toast } from "./ui";
import {
  aiAdjustUser,
  aiNote,
  formatLogTime,
  parseFormatLog,
  snapshotLabel,
  SOURCE_LABEL,
  stripFence,
  UAT_FORMAT_DEFAULT,
} from "./uat-format";

const PROMPT_ID = "uat-format-adjust";

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export function initUatFormatPanel(): void {
  const section = document.querySelector<HTMLElement>('.settings-section[data-cat="uat"]');
  if (!section) return;

  const ta = el<HTMLTextAreaElement>("uf-text");
  const noteInput = el<HTMLInputElement>("uf-note");
  const state = el("uf-state");
  const logBody = el("uf-log-body");
  const saveBtn = el<HTMLButtonElement>("uf-save");
  const aiBtn = el<HTMLButtonElement>("uf-ai");
  const resetBtn = el<HTMLButtonElement>("uf-reset");
  const aiHint = el("uf-ai-hint");
  if (!ta || !state) return;

  /**
   * 磁碟上那一份的內容。`null` = 還沒有檔案。
   *
   * 存在的理由只有一個：判斷「內容有沒有變」。拿 textarea 跟預設值比不行 ——
   * 那答不出「使用者把內容改回上一版存檔的樣子」該不該寫。
   */
  let saved: string | null = null;

  // 桌面版才有 `~/.anchorline`。瀏覽器版整塊講清楚為什麼不能用，
  // 而不是讓按鈕看起來能按、按下去才說不行。
  if (!isNative()) {
    section.querySelector<HTMLElement>(".uf-web-only")?.removeAttribute("hidden");
    ta.value = UAT_FORMAT_DEFAULT;
    ta.readOnly = true;
    ta.disabled = true;
    for (const b of [saveBtn, aiBtn, resetBtn]) if (b) b.disabled = true;
    if (noteInput) noteInput.disabled = true;
    state.textContent = "瀏覽器版看得到預設內容，但改不了 —— 規格檔在你的家目錄裡。";
    return;
  }

  // 這一塊的欄位不歸設定頁的 autoSave 管。不攔的話，textarea 失焦就會冒出
  // 「已儲存」—— 而規格檔根本還沒寫進去。假的成功訊息比沒有訊息糟。
  section.addEventListener("change", (e) => e.stopPropagation());

  function setState(msg: string, tone: "" | "ok" | "bad" = "") {
    if (!state) return;
    state.textContent = msg;
    state.className = tone ? `hint ${tone}` : "hint";
  }

  function refreshAiState() {
    if (!aiBtn) return;
    const ready = getAiReadiness();
    aiBtn.disabled = !ready.ok;
    if (aiHint) {
      aiHint.innerHTML = ready.ok
        ? ""
        : `${escapeHtml(ready.reason)} <button type="button" class="linkish" data-uf-goto-ai>去 AI 設定</button>`;
    }
  }

  async function loadFile() {
    const r = await native.uatFormatRead();
    if (isUnavailable(r)) {
      setState(`讀不到規格檔：${r.message}`, "bad");
      return;
    }
    if (r === null) {
      saved = null;
      ta!.value = UAT_FORMAT_DEFAULT;
      setState("（預設，尚未存檔）— 按下存檔才會建立 ~/.anchorline/uat-format.md");
      return;
    }
    saved = r;
    ta!.value = r;
    setState("已生效：~/.anchorline/uat-format.md", "ok");
  }

  async function refreshLog() {
    if (!logBody) return;
    const [logRaw, hist] = await Promise.all([
      native.uatFormatLog(),
      native.uatFormatHistory(),
    ]);
    const entries = isUnavailable(logRaw) || !logRaw ? [] : parseFormatLog(logRaw);
    const snaps = isUnavailable(hist) ? [] : hist;

    // 兩份清單刻意不合併。它們回答的是不同的問題：紀錄回答「改過幾次、
    // 為什麼改」，快照回答「哪幾版還原得回來」。第一次存檔會有紀錄但沒有
    // 快照（沒有舊內容可留），硬湊成一列會需要解釋那個空格。
    const logHtml = entries.length
      ? `<ul class="uf-log-list">${entries
          .map(
            (e) => `<li>
              <span class="uf-log-time mono">${escapeHtml(formatLogTime(e.ts))}</span>
              <span class="uf-log-src uf-src--${e.source}">${escapeHtml(SOURCE_LABEL[e.source])}</span>
              <span class="uf-log-note">${escapeHtml(e.note || "（沒有填說明）")}</span>
            </li>`,
          )
          .join("")}</ul>`
      : `<p class="hint">還沒有任何變更紀錄。</p>`;

    const snapHtml = snaps.length
      ? `<ul class="uf-snap-list">${snaps
          .map(
            (s) => `<li>
              <span class="mono">${escapeHtml(snapshotLabel(s.name, s.mtimeMs))}</span>
              <button type="button" class="btn btn-sm" data-uf-snap="${escapeHtml(s.name)}">檢視</button>
            </li>`,
          )
          .join("")}</ul>`
      : `<p class="hint">還沒有任何快照 —— 第一次存檔時沒有舊內容可以留。</p>`;

    logBody.innerHTML = `
      <p class="uf-sub">變更紀錄（${entries.length}）</p>
      ${logHtml}
      <p class="uf-sub">舊版快照（${snaps.length}）</p>
      ${snapHtml}`;
  }

  /**
   * 寫檔。回 true 代表真的寫進去了。
   *
   * 「內容沒變」回 false 而不是 throw：那不是失敗，是這次不需要做事。
   */
  async function write(source: "manual" | "ai", note: string): Promise<boolean> {
    const content = ta!.value;
    if (saved !== null && content === saved) {
      toast("內容沒有變，這次不寫 —— 也不會產生空的快照");
      return false;
    }
    const r = await native.uatFormatWrite(content, source, note);
    if (isUnavailable(r)) {
      setState(`存檔失敗：${r.message}`, "bad");
      toast(`存檔失敗：${r.message}`);
      return false;
    }
    saved = content;
    if (noteInput) noteInput.value = "";
    setState("已生效：~/.anchorline/uat-format.md", "ok");
    toast(r.snapshot ? `已存檔 · 上一版留成 ${r.snapshot}` : "已存檔 —— 出題 agent 下次出題就會照這份走");
    await refreshLog();
    return true;
  }

  saveBtn?.addEventListener("click", () => {
    const note = noteInput?.value.trim() || "手動編輯";
    void write("manual", note);
  });

  resetBtn?.addEventListener("click", () => {
    ta.value = UAT_FORMAT_DEFAULT;
    setState("已填回預設內容 —— 還沒存檔，按下存檔才會生效。");
  });

  // 「去 AI 設定」與「檢視快照」都是委派：清單是重畫的，直接綁在元素上
  // 每次重畫都要重綁一次，而漏綁的那一次不會報錯，只是點了沒反應。
  section.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-uf-goto-ai]")) {
      document.querySelector<HTMLButtonElement>('[data-set-cat="ai"]')?.click();
      return;
    }
    const snap = t.closest<HTMLElement>("[data-uf-snap]")?.dataset.ufSnap;
    if (snap) void openSnapshot(snap);
  });

  aiBtn?.addEventListener("click", () => openAiModal());

  // ── 快照檢視 ──────────────────────────────────────────────────

  async function openSnapshot(name: string) {
    const r = await native.uatFormatHistoryRead(name);
    if (isUnavailable(r) || r === null) {
      toast(isUnavailable(r) ? `讀不到這一版：${r.message}` : "讀不到這一版（檔案可能已被刪除）");
      return;
    }
    const back = modal(
      "uf-snap-back",
      `舊版快照 — ${escapeHtml(name)}`,
      `<pre>${escapeHtml(r)}</pre>`,
      `<button type="button" class="btn btn-ghost" data-uf-close>關閉</button>
       <button type="button" class="btn btn-primary" data-uf-restore>還原這一版</button>`,
    );
    back.addEventListener("click", (e) => {
      if (!(e.target as HTMLElement).closest("[data-uf-restore]")) return;
      ta!.value = r;
      back.remove();
      setState(`已填回 ${name} 的內容 —— 還沒存檔，按下存檔才會生效。`);
    });
  }

  // ── AI 調整 ───────────────────────────────────────────────────

  function openAiModal() {
    const ready = getAiReadiness();
    if (!ready.ok) {
      // 按鈕本來就該是灰的。走到這裡代表狀態沒跟上（例如剛清掉金鑰），
      // 講原因總比讓它靜靜地什麼都不做好。
      toast(ready.reason);
      refreshAiState();
      return;
    }
    const back = modal(
      "uf-ai-back",
      "AI 調整格式規格",
      `<p class="uf-ai-lead">說一句你想怎麼調整。模型會依指示改寫，回傳修訂後的<b>完整規格</b>，
         你看過前後對照再決定要不要套用。</p>
       <textarea id="uf-ai-instruction" class="uf-ai-instruction" rows="3"
         placeholder="例如：題數上限改成 20 題，並加一條「每題流程最多 8 步」"></textarea>
       <div id="uf-ai-out"></div>`,
      `<button type="button" class="btn btn-ghost" data-uf-close>取消</button>
       <button type="button" class="btn btn-primary" data-uf-run>送出</button>`,
    );

    const out = back.querySelector<HTMLElement>("#uf-ai-out")!;
    const foot = back.querySelector<HTMLElement>("footer")!;
    let result = "";

    back.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-uf-run]")) void run();
      else if (t.closest("[data-uf-apply]")) void apply();
      else if (t.closest("[data-uf-back]")) reset();
    });

    function reset() {
      result = "";
      out.innerHTML = "";
      foot.innerHTML = `<button type="button" class="btn btn-ghost" data-uf-close>取消</button>
        <button type="button" class="btn btn-primary" data-uf-run>送出</button>`;
    }

    async function run() {
      const box = back.querySelector<HTMLTextAreaElement>("#uf-ai-instruction");
      const instruction = box?.value.trim() ?? "";
      if (!instruction) {
        toast("先寫一句指示 —— 模型才知道要調什麼");
        return;
      }
      const current = ta!.value;
      out.innerHTML = `<p class="uf-ai-busy">正在依指示修訂規格…</p>`;
      foot.innerHTML = `<button type="button" class="btn btn-ghost" data-uf-close>取消</button>`;
      try {
        const raw = await chatCompletion(promptSystem(PROMPT_ID), aiAdjustUser(current, instruction), {
          temperature: promptTemperature(PROMPT_ID),
        });
        // 模型照樣會用圍欄包 —— prompt 講了是請求不是保證。不剝的話，
        // 存進去的規格第一行就是 ```markdown，下一輪再包一層。
        result = stripFence(raw);
        if (!result.trim()) throw new Error("模型回傳空內容");
        out.innerHTML = `
          <p class="uf-sub">修訂後（${result.length} 字）</p>
          <pre class="uf-ai-after">${escapeHtml(result)}</pre>
          <p class="uf-sub">目前版本（${current.length} 字）</p>
          <pre class="uf-ai-before">${escapeHtml(current)}</pre>`;
        foot.innerHTML = `<button type="button" class="btn btn-ghost" data-uf-close>放棄</button>
          <button type="button" class="btn" data-uf-back>改指示</button>
          <button type="button" class="btn btn-primary" data-uf-apply>套用並存檔</button>`;
      } catch (err) {
        // AI 失敗照 ai-client 的慣例把原訊息講出來，**不寫檔**。
        const msg = err instanceof Error ? err.message : String(err);
        out.innerHTML = `<p class="uf-ai-err">${escapeHtml(msg)}</p>`;
        foot.innerHTML = `<button type="button" class="btn btn-ghost" data-uf-close>關閉</button>
          <button type="button" class="btn btn-primary" data-uf-run>重試</button>`;
      }
    }

    async function apply() {
      const box = back.querySelector<HTMLTextAreaElement>("#uf-ai-instruction");
      const note = aiNote(box?.value ?? "");
      ta!.value = result;
      back.remove();
      // 套用即存檔：使用者已經在上一畫面看過完整結果並按了套用。
      await write("ai", note || "AI 調整");
    }
  }

  // ── 起手式 ───────────────────────────────────────────────────

  refreshAiState();
  void loadFile();
  void refreshLog();
  // 金鑰是在同一頁的「AI 工具」分類填的。不跟著設定變動重算的話，使用者
  // 填完金鑰切回來，按鈕還是灰的 —— 而畫面上沒有任何線索說要重整。
  store.subscribe(refreshAiState);
}

/**
 * 照 tracking.ts 的 uat-diff 慣例開一個 modal：`modal-back.open` + `.modal`，
 * 點背景或關閉鈕就移除。同 id 的舊 modal 先拆掉 —— 連開兩次會疊出兩層，
 * 而上面那層關掉之後下面那層還在，看起來像關不掉。
 */
function modal(id: string, title: string, body: string, footer: string): HTMLElement {
  document.getElementById(id)?.remove();
  const back = document.createElement("div");
  back.id = id;
  back.className = "modal-back open";
  back.innerHTML = `
    <div class="modal uf-modal" role="dialog" aria-modal="true" aria-label="${title}">
      <header><h3>${title}</h3>
        <button type="button" class="btn btn-sm btn-ghost" data-uf-close>關閉</button></header>
      <div class="body uf-modal-body">${body}</div>
      <footer>${footer}</footer>
    </div>`;
  back.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === back || t.closest("[data-uf-close]")) back.remove();
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    back.remove();
    document.removeEventListener("keydown", onKey);
  };
  document.addEventListener("keydown", onKey);
  document.body.appendChild(back);
  return back;
}
