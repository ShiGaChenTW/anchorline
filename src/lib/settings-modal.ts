/**
 * 偏好設定改成彈出視窗。
 *
 * 用 iframe 載入既有的 settings.html，不把設定畫面重寫一份在 modal 裡。
 * 設定頁有分類側欄、十幾個區塊、儲存邏輯與測試連線；複製一份出來只會
 * 產生兩份會各自腐爛的畫面。iframe 讓它們永遠是同一份。
 *
 * ADHD 取捨：設定是「離開主線去調一個東西」。整頁跳轉會把你原本在做的事
 * 推出視野，回來時要重新建立情境。浮在上面的視窗把主畫面留在背景，
 * 關掉就回到原位 —— 中斷成本從「重新導航」降到「按 Esc」。
 */

const SIZE_KEY = "specforge:settings-modal-size";

function saveSize(w: number, h: number) {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify({ w, h }));
  } catch {
    /* private mode */
  }
}

function loadSize(): { w: number; h: number } | null {
  try {
    const raw = localStorage.getItem(SIZE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { w?: number; h?: number };
    return typeof v.w === "number" && typeof v.h === "number" ? { w: v.w, h: v.h } : null;
  } catch {
    return null;
  }
}

export function openSettingsModal() {
  if (document.getElementById("settings-modal-back")) return;

  const back = document.createElement("div");
  back.id = "settings-modal-back";
  back.className = "set-modal-back";
  back.innerHTML = `
    <div class="set-modal" role="dialog" aria-modal="true" aria-label="偏好設定">
      <header class="set-modal-head">
        <strong>偏好設定</strong>
        <span class="set-modal-hint">變更會自動儲存 · 拖右下角可調整大小 · Esc 關閉</span>
        <button type="button" class="btn btn-sm btn-ghost" data-set-modal="close">關閉</button>
      </header>
      <iframe class="set-modal-frame" src="settings.html" title="偏好設定"></iframe>
    </div>
  `;
  document.body.appendChild(back);

  const box = back.querySelector(".set-modal") as HTMLElement;

  // 預設 40% 視窗；使用者拉過就記住他拉的尺寸。
  const saved = loadSize();
  if (saved) {
    box.style.width = `${Math.min(saved.w, window.innerWidth - 24)}px`;
    box.style.height = `${Math.min(saved.h, window.innerHeight - 24)}px`;
  }

  // 設定改過就在關窗時重讀 —— 背景那一頁的 store 已經是舊的。
  // ponytail: 直接 reload，不做跨 frame 狀態同步協定。設定不是高頻操作。
  const frame = back.querySelector(".set-modal-frame") as HTMLIFrameElement;
  let touched = false;
  frame.addEventListener("load", () => {
    try {
      frame.contentDocument?.addEventListener("change", () => {
        touched = true;
      });
    } catch {
      /* 同源才拿得到，取不到就算了 */
    }
  });

  const close = () => {
    saveSize(box.offsetWidth, box.offsetHeight);
    back.remove();
    document.removeEventListener("keydown", onKey);
    if (touched) window.location.reload();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);
  back.querySelector('[data-set-modal="close"]')?.addEventListener("click", close);
  back.addEventListener("click", (e) => {
    if (e.target === back) close();
  });
}

/** 把齒輪與任何 settings.html 連結攔下來改開彈窗 */
export function initSettingsModal() {
  // settings.html 自己（iframe 裡）不要再攔一層
  if (window.self !== window.top) return;
  if (location.pathname.endsWith("settings.html")) return;
  if (document.documentElement.dataset.setModalBound === "1") return;
  document.documentElement.dataset.setModalBound = "1";

  document.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement | null)?.closest?.(
      'a[href="settings.html"], a[href$="/settings.html"]',
    ) as HTMLAnchorElement | null;
    if (!a) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey) return; // 想開新分頁就讓他開
    e.preventDefault();
    openSettingsModal();
  });
}
