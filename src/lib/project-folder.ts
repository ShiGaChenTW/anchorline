/**
 * 「這份 PRD 對應到磁碟上哪個資料夾？」
 *
 * 手動新建的 PRD 沒有資料夾，於是編輯台的檔案樹是空的、匯出的 OpenSpec
 * 也不知道該放哪。這支負責在建立後主動問一次，並把答案綁回專案。
 *
 * 能力邊界（誠實面對）：
 * - **桌面版**：走 NSOpenPanel，`canCreateDirectories = true`，
 *   使用者可以在面板裡直接「新增資料夾」。macOS 幫我們建，app 本身不寫磁碟。
 * - **瀏覽器版**：`webkitdirectory` 只能「選」既有資料夾，**不能建**。
 *   所以瀏覽器的文案不會說「新增」，只說「選擇」，並指出要建資料夾請用桌面版。
 *
 * 綁定不等於匯入：不評分、不覆蓋章節內容。手動寫的 PRD 是先有內容才有資料夾。
 */
import { store } from "../data/store";
import { isNative, native } from "./native";
import { classifyPath } from "./folder-import";
import { escapeHtml, toast } from "./ui";

export function isDesktopApp(): boolean {
  return isNative();
}

function bind(projectId: string, name: string, path: string, paths: string[]) {
  // classifyPath 只看路徑不看內文，所以綁定時就能算出「哪個檔對哪一節」，
  // 不需要真的去讀檔。沒有這步，檔案樹只是一份檔名清單。
  const matched = paths
    .map((p) => ({ path: p, ...classifyPath(p) }))
    .filter((m) => m.slot !== "other" && m.confidence >= 80)
    .map((m) => ({ slot: m.slot as string, path: m.path, contentScore: 0 }));

  store.bindProjectFolder(projectId, name, path, paths, matched);
  toast(`已綁定 ${name}：${paths.length} 個檔案 · ${matched.length} 個對到章節`);
}

/**
 * 桌面版：叫出系統資料夾選擇器（可新建資料夾）。
 *
 * 舊版聽全域 `anchorline-native` 事件，因為那個 callback 被 projects.ts 佔用了。
 * Tauri 的 invoke 回 Promise，兩個流程各自等自己的，沒有共用狀態要搶。
 */
async function pickNative(projectId: string) {
  toast("請在系統對話框選擇或新增資料夾…");
  let r;
  try {
    r = await native.pickProjectFolder();
  } catch {
    toast("無法開啟系統對話框，請重啟 App");
    return;
  }
  if (r.cancelled) {
    toast("已取消，稍後可從編輯台的「專案檔案」再指定");
    return;
  }
  bind(projectId, r.folderName || "專案資料夾", r.folderPath, r.files.map((f) => f.path));
}
/** 瀏覽器版：只能選既有資料夾 */
function pickBrowser(projectId: string) {
  const input = document.createElement("input");
  input.type = "file";
  input.setAttribute("webkitdirectory", "");
  input.setAttribute("directory", "");
  input.multiple = true;
  input.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px";
  document.body.appendChild(input);

  input.addEventListener("change", () => {
    const files = Array.from(input.files ?? []);
    input.remove();
    if (!files.length) return;
    const paths = files.map(
      (f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
    );
    const name = paths[0]?.split("/")[0] || "專案資料夾";
    bind(projectId, name, "", paths);
  });

  input.click();
}

export function pickProjectFolder(projectId: string) {
  if (isDesktopApp()) void pickNative(projectId);
  else pickBrowser(projectId);
}

/**
 * 新建 PRD 之後問一次。不是 confirm()：瀏覽器原生對話框會卡住 WebView，
 * 而且這裡需要說明「桌面版能建、瀏覽器只能選」的差別，一行文字塞不下。
 */
export function askForProjectFolder(projectId: string, projectTitle: string) {
  document.getElementById("pf-ask")?.remove();

  const desktop = isDesktopApp();
  const back = document.createElement("div");
  back.className = "modal-back open";
  back.id = "pf-ask";
  back.innerHTML = `
    <div class="modal" role="dialog" aria-labelledby="pf-title" aria-modal="true">
      <header>
        <h3 id="pf-title">「${escapeHtml(projectTitle)}」還沒有對應的資料夾</h3>
        <button type="button" class="btn btn-ghost btn-sm" data-pf="later">關閉</button>
      </header>
      <div class="body">
        <p class="sub">綁定之後，編輯台左側會顯示這個資料夾的檔案結構，你也才看得出哪些檔是 PRD 來源、哪些是 OpenSpec 產出。</p>
        <p class="sub">${
          desktop
            ? "在系統對話框裡可以直接用左下角「新增資料夾」建一個新的。"
            : "瀏覽器只能<strong>選擇既有</strong>資料夾，不能新建。要新建請改用桌面版 App，或先在 Finder 建好再回來選。"
        }</p>
        <p class="sub pf-note">綁定只記錄對應關係，不會掃描覆蓋你剛寫的內容。</p>
      </div>
      <footer>
        <button type="button" class="btn" data-pf="later">稍後再說</button>
        <button type="button" class="btn btn-primary" data-pf="pick">${
          desktop ? "選擇或新增資料夾" : "選擇資料夾"
        }</button>
      </footer>
    </div>
  `;
  document.body.appendChild(back);

  back.querySelectorAll('[data-pf="later"]').forEach((b) =>
    b.addEventListener("click", () => back.remove()),
  );
  back.querySelector('[data-pf="pick"]')?.addEventListener("click", () => {
    back.remove();
    pickProjectFolder(projectId);
  });
}

// ponytail: 綁定只寫 sourceFolder + allPaths，不跑 folder-import 的評分流程。
// 要完整評分就走既有的「專案匯入」——兩條路刻意分開，避免手寫內容被掃描結果蓋掉。
