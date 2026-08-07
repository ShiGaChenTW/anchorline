import { APP_VARIANT } from "../data/seed";
import { store } from "../data/store";
import { initTheme } from "../lib/theme";
import { setBeginnerMode } from "../lib/beginner-flow";

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
const MAX = 2;
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
  // 最後一步：若「下一步」仍可見（hidden 被 CSS 蓋掉），改走完成
  if (step === MAX) {
    finishOnboarding();
  }
});

$("ob-finish")?.addEventListener("click", () => finishOnboarding());

setStep(0);
syncImportUi();
