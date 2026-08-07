/**
 * 首次使用導覽 —— 只教心智模型，不教操作。
 *
 * 這個 app 已經有四個引導面：onboarding（帳號設定）、`?` 快捷鍵浮層、
 * 編輯台新手教練（逐節）、新建三問精靈。缺的不是第五份操作說明，
 * 是「這整套東西是怎麼串起來的」——寫規格 → 結構檢查擋你 → 過了送審 → 匯出給 agent。
 *
 * ADHD 設計約束：
 * - **三拍，每拍一句話。** 不是十步導覽，不是一面文字牆。
 * - **指著真的東西講。** 聚光燈打在實際按鈕上，不是抽象截圖。
 * - **隨時能走。** 每拍都有「略過」，Esc 也可以。走了不再煩。
 * - **可以回頭看。** 按 `?` 的浮層裡有「重看導覽」，不是一次性消耗品。
 * - 尊重 prefers-reduced-motion。
 */

const SEEN_KEY = "specforge:tour-seen:v1";

type Beat = {
  /** 聚光燈打在誰身上；找不到就置中顯示，不會整段消失 */
  anchor: string;
  title: string;
  body: string;
};

const BEATS: Beat[] = [
  {
    anchor: "#btn-new",
    title: "從這裡開一份規格",
    body: "只會問三個問題，約 90 秒。答不出來的可以跳過，進去再補。",
  },
  {
    anchor: '[data-od-id="nav-editor"]',
    title: "編輯台一次只叫你做一件事",
    body: "規格拆成 7 節，右側永遠只指一個「現在做這一件」。卡住的時候畫面會變安靜，不是變吵。",
  },
  {
    // 刻意不指「匯出 OpenSpec」：那顆會被 adhd-ui 收進「更多」，指了會落空
    anchor: '[data-od-id="nav-review"]',
    title: "寫完不是結束",
    body: "結構檢查過了才能送審。核准後從匯出選單產出 OpenSpec 三件套，交給 Claude Code 之類的 agent 接手實作。",
  },
];

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true; // 讀不到就當看過，寧可不煩人
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* private mode */
  }
}

let cleanup: (() => void) | null = null;

function close() {
  cleanup?.();
  cleanup = null;
  document.getElementById("tour-root")?.remove();
  markSeen();
}

function paint(i: number) {
  const beat = BEATS[i];
  if (!beat) return close();

  const root = document.getElementById("tour-root");
  if (!root) return;

  // 元素存在但被收起來（例如被 adhd-ui 掃進「更多」）也算沒有錨點 ——
  // 對著 0×0 的矩形打聚光燈，會落在畫面左上角這種完全無關的位置
  const found = document.querySelector(beat.anchor) as HTMLElement | null;
  const visible =
    !!found && found.offsetParent !== null && found.getBoundingClientRect().width > 0;
  const target = visible ? found : null;
  const spot = root.querySelector(".tour-spot") as HTMLElement;
  const card = root.querySelector(".tour-card") as HTMLElement;

  if (target) {
    const r = target.getBoundingClientRect();
    const pad = 6;
    spot.style.display = "block";
    spot.style.top = `${r.top - pad}px`;
    spot.style.left = `${r.left - pad}px`;
    spot.style.width = `${r.width + pad * 2}px`;
    spot.style.height = `${r.height + pad * 2}px`;

    // 卡片貼在目標下方；靠近底部就翻到上方，不要被切掉
    const below = r.bottom + 12;
    const flip = below + 190 > window.innerHeight;
    card.style.top = flip ? "" : `${below}px`;
    card.style.bottom = flip ? `${window.innerHeight - r.top + 12}px` : "";
    card.style.left = `${Math.min(Math.max(12, r.left), window.innerWidth - 360)}px`;
    card.style.transform = "";
  } else {
    // 找不到錨點（頁面不同／元素被收進「更多」）就置中，內容照講
    spot.style.display = "none";
    card.style.top = "50%";
    card.style.bottom = "";
    card.style.left = "50%";
    card.style.transform = "translate(-50%, -50%)";
  }

  card.innerHTML = `
    <p class="tour-step">${i + 1} / ${BEATS.length}</p>
    <h4 class="tour-title">${beat.title}</h4>
    <p class="tour-body">${beat.body}</p>
    <div class="tour-actions">
      <button type="button" class="btn btn-sm btn-ghost" data-tour="skip">略過導覽</button>
      <button type="button" class="btn btn-sm btn-primary" data-tour="next">${
        i === BEATS.length - 1 ? "開始使用" : "知道了"
      }</button>
    </div>
  `;

  card.querySelector('[data-tour="skip"]')?.addEventListener("click", close);
  card.querySelector('[data-tour="next"]')?.addEventListener("click", () => paint(i + 1));
  (card.querySelector('[data-tour="next"]') as HTMLElement | null)?.focus();
}

/** 真正跑導覽。startTour 由「重看導覽」直接呼叫，繞過 seen 檢查。 */
export function startTour() {
  if (document.getElementById("tour-root")) return;

  const root = document.createElement("div");
  root.id = "tour-root";
  root.className = "tour-root";
  root.innerHTML = `<div class="tour-spot"></div><div class="tour-card" role="dialog" aria-modal="true" aria-label="首次使用導覽"></div>`;
  document.body.appendChild(root);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  const onResize = () => {
    // 重畫目前這一拍：視窗變了聚光燈就對不準
    const step = Number(
      (document.querySelector(".tour-step")?.textContent ?? "1").split("/")[0]?.trim() ?? 1,
    );
    paint(step - 1);
  };
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", onResize);
  cleanup = () => {
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onResize);
  };

  paint(0);
}

/**
 * 首次載入時自動跑一次。
 * 只在專案列表頁跑：那是所有路徑的入口，也是三個錨點都在的地方。
 */
export function initFirstRunTour() {
  if (seen()) return;
  if (!document.getElementById("btn-new")) return; // 不是專案頁就不跑

  // 等版面穩定再量位置，否則聚光燈會打在錯的座標上
  requestAnimationFrame(() =>
    window.setTimeout(() => {
      if (!seen()) startTour();
    }, 400),
  );
}

// ponytail: 聚光燈用一個超大 box-shadow 挖洞，不做 SVG mask。
// 少一個 DOM 節點、少一次重繪，視覺結果一樣。
