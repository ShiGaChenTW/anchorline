import { APP_VARIANT } from "../data/seed";
import { store } from "../data/store";
import { ACCESS_ROLE_LABEL, AGENT_FAMILY_LABEL } from "../data/types";
import { initTheme } from "../lib/theme";
import { escapeHtml } from "../lib/ui";

initTheme();

// 正式版首次使用 → 引導建立管理員
if (store.needsOnboarding()) {
  location.href = "onboarding.html";
}

// Already logged in → workspace
if (store.get().session?.userId) {
  const u = store.get().employees.find((e) => e.id === store.get().session!.userId);
  if (u && u.active !== false) {
    location.href = "overview.html";
  }
}

const select = document.getElementById("user-select") as HTMLSelectElement;
const preview = document.getElementById("role-preview")!;
const errEl = document.getElementById("login-error")!;
const pwd = document.getElementById("password") as HTMLInputElement;

function renderOptions() {
  const employees = store
    .get()
    .employees.filter((e) => e.active !== false && e.id !== "__setup__");
  if (!employees.length) {
    select.innerHTML = `<option value="">（尚無帳號 — 請完成首次引導）</option>`;
    preview.textContent = "—";
    return;
  }
  select.innerHTML = employees
    .map((e) => {
      const kind = e.kind === "agent" ? "Agent" : "人員";
      const role = ACCESS_ROLE_LABEL[e.accessRole];
      return `<option value="${e.id}">${escapeHtml(e.name)} · ${role}（${kind}）</option>`;
    })
    .join("");
  updatePreview();
}

function updatePreview() {
  const e = store.get().employees.find((x) => x.id === select.value);
  if (!e) {
    preview.textContent = "—";
    return;
  }
  const bits = [
    ACCESS_ROLE_LABEL[e.accessRole],
    e.kind === "agent" ? "Agent" : "人員",
    e.agentFamily ? AGENT_FAMILY_LABEL[e.agentFamily] : e.title,
  ];
  preview.textContent = bits.join(" · ");
}

select.addEventListener("change", updatePreview);

document.querySelectorAll("[data-quick]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const id = (btn as HTMLElement).dataset.quick!;
    if ([...select.options].some((o) => o.value === id)) {
      select.value = id;
      updatePreview();
      pwd.value = "demo";
      pwd.focus();
    }
  });
});

document.getElementById("login-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  errEl.textContent = "";
  const ok = store.login(select.value, pwd.value);
  if (!ok) {
    errEl.textContent = "登入失敗：帳號或密碼不正確";
    return;
  }
  location.href = "overview.html";
});

renderOptions();
const preferred =
  store.get().employees.find((e) => e.kind === "human" && e.accessRole === "admin" && e.active !== false) ??
  store.get().employees.find((e) => e.active !== false && e.id !== "__setup__");
if (preferred) {
  select.value = preferred.id;
  updatePreview();
}
// 測試版預填 demo；正式版不預填密碼
if (APP_VARIANT === "test") {
  pwd.value = "demo";
} else {
  pwd.value = "";
  pwd.placeholder = "請輸入密碼";
}

// 正式版隱藏示範快速身分
if (APP_VARIANT !== "test") {
  document.querySelector(".quick-roles")?.remove();
  const hint = document.querySelector(".login-hint");
  if (hint) {
    hint.innerHTML =
      "正式版：請使用首次引導建立的管理員帳號登入。<br />可在「管理中心」新增人員與 Agent，在「Agent 管理」調整 prompt 與進場作業。";
  }
}
