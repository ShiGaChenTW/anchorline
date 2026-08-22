import { APP_VARIANT } from "../data/seed";
import { store } from "../data/store";
import { initTheme } from "../lib/theme";
import { setBeginnerMode } from "../lib/beginner-flow";
import { isNative, native } from "../lib/native";
import { escapeHtml } from "../lib/ui";

initTheme();

// 測試版不走此引導
if (APP_VARIANT === "test") {
  location.href = "login.html";
}

// 已完成引導且有管理員 → 登入頁或工作區
if (!store.needsOnboarding()) {
  if (store.get().session?.userId) location.href = "overview.html";
  else location.href = "login.html";
}

let step = 0;
const MAX = 3;
let importFile: { name: string; text: string } | null = null;

function $(id: string) {
  return document.getElementById(id);
}

function setStep(n: number) {
  step = Math.max(0, Math.min(MAX, n));
  document.querySelectorAll(".onboard-pane").forEach((p) => {
    const i = Number((p as HTMLElement).dataset.pane);
    (p as HTMLElement).hidden = i !== step;
  });
  document.querySelectorAll("#onboard-steps [data-step]").forEach((s) => {
    const i = Number((s as HTMLElement).dataset.step);
    s.classList.toggle("on", i === step);
    s.classList.toggle("done", i < step);
  });
  const prev = $("ob-prev") as HTMLButtonElement | null;
  const next = $("ob-next") as HTMLButtonElement | null;
  const finish = $("ob-finish") as HTMLButtonElement | null;
  if (prev) prev.hidden = step === 0;
  if (next) next.hidden = step === MAX;
  if (finish) finish.hidden = step !== MAX;
}

// ── 開發工具偵測 ─────────────────────────────────────────────────────
//
// 三個 CLI 都是**選用**的，所以這一步從不擋人往下走。它存在的理由是時機：
// 缺 openspec 的症狀（OpenSpec 那幾頁顯示不出狀態）出現得比安裝晚很多，
// 到那時候使用者已經不記得自己跳過了什麼。在這裡講一次最便宜。

const TOOLS: { id: string; name: string; why: string; install: string }[] = [
  {
    id: "git",
    name: "git",
    why: "沒有它就沒有 commit、沒有專案統計，也沒有治理覆蓋率",
    install: "xcode-select --install",
  },
  {
    id: "openspec",
    name: "openspec",
    why: "OpenSpec 那幾頁的狀態、進度與健康度都讀它的輸出",
    install: "npm i -g @fission-ai/openspec",
  },
  {
    id: "gh",
    name: "gh",
    why: "PR 雷達要用；不裝只是那張卡片空著",
    install: "brew install gh",
  },
];

async function renderTools() {
  const host = $("ob-tools");
  if (!host) return;
  if (!isNative()) {
    // 瀏覽器版沒有辦法看到 PATH。講「偵測不到」會被讀成「沒裝」，那是兩件事。
    host.innerHTML = `<p class="hint">瀏覽器版看不到你的 PATH，偵測要在桌面版 App 才做得到。</p>`;
    return;
  }
  host.innerHTML = `<p class="hint">偵測中…</p>`;
  let found: Record<string, string | null> = {};
  try {
    found = await native.probeClis();
  } catch {
    host.innerHTML = `<p class="hint">偵測失敗。可以先跳過，之後在「偏好設定」指定路徑。</p>`;
    return;
  }
  host.innerHTML = TOOLS.map((t) => {
    const path = found[t.id];
    return path
      ? `<div class="onboard-tool is-ok">
           <strong>${escapeHtml(t.name)}</strong>
           <span class="onboard-tool-state">已安裝</span>
           <code>${escapeHtml(path)}</code>
         </div>`
      : `<div class="onboard-tool is-missing">
           <strong>${escapeHtml(t.name)}</strong>
           <span class="onboard-tool-state">找不到</span>
           <p class="hint">${escapeHtml(t.why)}</p>
           <code>${escapeHtml(t.install)}</code>
         </div>`;
  }).join("");
}

$("ob-tools-recheck")?.addEventListener("click", () => void renderTools());

function err(pane: number, msg: string) {
  const el = $(`ob-err-${pane}`);
  if (el) el.textContent = msg;
}

function clearErr(pane: number) {
  err(pane, "");
}

function validateAdmin(): boolean {
  clearErr(0);
  const name = ($("ob-name") as HTMLInputElement).value.trim();
  const email = ($("ob-email") as HTMLInputElement).value.trim();
  const pass = ($("ob-pass") as HTMLInputElement).value;
  const pass2 = ($("ob-pass2") as HTMLInputElement).value;
  if (!name) {
    err(0, "請填寫姓名");
    return false;
  }
  if (!email.includes("@")) {
    err(0, "請填寫有效 Email");
    return false;
  }
  if (pass.length < 4) {
    err(0, "密碼至少 4 字元");
    return false;
  }
  if (pass !== pass2) {
    err(0, "兩次密碼不一致");
    return false;
  }
  return true;
}

function selectedImportMode(): "beginner" | "import" | "blank" {
  const el = document.querySelector('input[name="import-mode"]:checked') as HTMLInputElement | null;
  const v = el?.value;
  if (v === "import" || v === "blank") return v;
  return "beginner";
}

function syncImportUi() {
  const mode = selectedImportMode();
  const wrap = $("ob-import-wrap");
  if (wrap) wrap.hidden = mode !== "import";
}

document.querySelectorAll('input[name="import-mode"]').forEach((r) => {
  r.addEventListener("change", syncImportUi);
});

$("ob-file")?.addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  const hint = $("ob-file-hint");
  importFile = null;
  if (!file) {
    if (hint) hint.textContent = "尚未選擇檔案";
    return;
  }
  try {
    const text = await file.text();
    importFile = { name: file.name, text };
    if (hint) hint.textContent = `已選：${file.name}（${Math.round(text.length / 1024)} KB）`;
  } catch {
    if (hint) hint.textContent = "讀取失敗，請再試一次";
  }
});

function finishOnboarding() {
  clearErr(2);
  // 若使用者刷新後只在 step 2，確保 admin 已存在
  if (store.needsOnboarding()) {
    err(2, "請先完成管理員建立（上一步）");
    setStep(0);
    return;
  }

  const install = ($("ob-install-agents") as HTMLInputElement)?.checked;
  if (install) {
    const admin = store.get().employees.find((e) => e.kind === "human" && e.accessRole === "admin");
    store.installStarterAgents(admin?.password);
  }

  const mode = selectedImportMode();
  store.completeOnboarding({ next: mode });

  if (mode === "import" && importFile) {
    const r = store.importMarkdownProject(importFile.name, importFile.text);
    if (!r.ok) {
      err(2, r.reason ?? "匯入失敗");
      return;
    }
    setBeginnerMode(false);
    location.href = "editor.html";
    return;
  }

  if (mode === "beginner") {
    setBeginnerMode(true);
    location.href = "projects.html?beginner=1";
    return;
  }

  location.href = "overview.html";
}

$("ob-prev")?.addEventListener("click", () => setStep(step - 1));

$("ob-next")?.addEventListener("click", () => {
  if (step === 0) {
    // 已建立管理員（從後續步驟返回）則略過重建
    const already =
      !store.needsOnboarding() &&
      store.get().employees.some(
        (e) => e.kind === "human" && e.accessRole === "admin" && e.id !== "__setup__",
      );
    if (!already) {
      if (!validateAdmin()) return;
      const r = store.bootstrapAdmin({
        name: ($("ob-name") as HTMLInputElement).value,
        email: ($("ob-email") as HTMLInputElement).value,
        password: ($("ob-pass") as HTMLInputElement).value,
        title: ($("ob-title") as HTMLInputElement).value,
      });
      if (!r.ok) {
        err(0, r.reason ?? "建立失敗");
        return;
      }
    }
    setStep(1);
    return;
  }
  if (step === 1) {
    clearErr(1);
    if (selectedImportMode() === "import" && !importFile) {
      err(1, "請選擇要匯入的 Markdown 檔，或改選其他方式");
      return;
    }
    setStep(2);
    return;
  }
  if (step === 2) {
    setStep(3);
    // 進到這一步才偵測。放在進場一次跑掉的話，使用者填管理員資料的那段時間
    // 裡結果就過期了——而這一步正好是他可能開另一個終端機去裝東西的時候。
    void renderTools();
    return;
  }
  // 最後一步：若「下一步」仍可見（hidden 被 CSS 蓋掉），改走完成
  if (step === MAX) {
    finishOnboarding();
  }
});

$("ob-finish")?.addEventListener("click", () => finishOnboarding());

setStep(0);
syncImportUi();
