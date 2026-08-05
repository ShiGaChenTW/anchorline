import { store } from "../data/store";
import { ACCESS_ROLE_LABEL, AGENT_FAMILY_LABEL } from "../data/types";
import { initTheme } from "../lib/theme";
import { escapeHtml } from "../lib/ui";

initTheme();

// Already logged in → workspace
if (store.get().session?.userId) {
  const u = store.get().employees.find((e) => e.id === store.get().session!.userId);
  if (u && u.active !== false) {
    location.href = "projects.html";
  }
}

const select = document.getElementById("user-select") as HTMLSelectElement;
const preview = document.getElementById("role-preview")!;
const errEl = document.getElementById("login-error")!;
const pwd = document.getElementById("password") as HTMLInputElement;

function renderOptions() {
  const employees = store.get().employees.filter((e) => e.active !== false);
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
  location.href = "projects.html";
});

renderOptions();
// Prefer admin as default for first-time? Keep first seed current (editor)
const preferred = store.get().employees.find((e) => e.id === "scott") ?? store.get().employees[0];
if (preferred) {
  select.value = preferred.id;
  updatePreview();
}
pwd.value = "demo";
