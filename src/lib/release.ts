import { VERSION_RE } from "./release-track";
/**
 * 版本取號與內容編列。
 *
 * **核心規則：版號一律由使用者決定，系統絕不自動指定。**
 *
 * 系統會做的只有兩件事：告訴你上一版是什麼（讓你有參照）、以及在你打的
 * 版號重複或格式不合時攔下來。它不會幫你 +1，也不會在你沒填的時候塞一個
 * 預設值 —— 版號是對外承諾，那個決定必須是人做的。
 *
 * 純函式、零 I/O，方便直接測。
 */

/** 內容項目的完成狀態 —— 一版裡可以同時有做完的和還沒做的 */
export type ReleaseItemState = "done" | "planned";

/**
 * 項目從哪裡來。manual 是使用者自己打的。
 *
 * `change` 是 openspec 的變更代號，只出現在 `planned` 路線 ——
 * 那條路收的是還沒實作的東西，所以它引用的是規格，不是既成的 commit。
 */
export type ReleaseItemSource = "section" | "commit" | "manual" | "change";

export type ReleaseItem = {
  id: string;
  text: string;
  state: ReleaseItemState;
  source: ReleaseItemSource;
  /** 來源的原始識別（章節 id / commit hash），manual 為空 */
  ref?: string;
};

export type ReleaseStatus = "draft" | "locked" | "handed";

/**
 * 這一版動的是哪一段。判定與閘門在 `release-track.ts`。
 *
 * 舊資料沒有這個欄位，讀進來是 undefined —— 那些版號在規則上路之前就存在，
 * 不套層級閘門（回頭補判定只會把既有版號變成「不合法」，而它們已經發出去了）。
 */
export type ReleaseLevelId = "major" | "minor" | "patch";

export type Release = {
  id: string;
  projectId: string;
  /** 使用者輸入的版號，原文保留 */
  version: string;
  /** 省略＝規則上路前的舊版號，不套層級閘門 */
  level?: ReleaseLevelId;
  /**
   * 正式放行的時間。null＝還在規劃。
   *
   * 取號與放行分開，是因為所有層級都可以預先取號用來規劃版本更新，
   * 而 push 出去收不回來 —— 那個決定要有一個明確按下去的瞬間。
   */
  releasedAt?: string | null;
  title: string;
  note: string;
  status: ReleaseStatus;
  items: ReleaseItem[];
  createdAt: string;
  updatedAt: string;
  /** 送交執行的時間；沒送過為 null */
  handedAt: string | null;
};

// ── 版號驗證 ────────────────────────────────────────────────────

export type VersionCheck = { ok: true } | { ok: false; reason: string };

/**
 * 版號政策，**每個專案自己選一次**。
 *
 * - `loose`：預設。只擋掉「一定會出問題」的，不強迫任何體例。
 * - `strict`：`vX.YY.ZZ`，三段各自綁定取號條件（見 `release-track.ts`）。
 *
 * **選了 strict 就回不去。** 這不是為了懲罰反悔，是因為在 strict 底下發出去的
 * 版號帶著保證：`v1.02.00` 的 YY 是「這一版走過 OpenSpec」的憑證。退回 loose
 * 之後那個保證沒有東西背書，而號已經在別人的 changelog 與 git tag 裡了。
 */
export type VersionPolicy = "loose" | "strict";

/** 舊專案沒有這個欄位，一律當 loose —— 那是這條規則出現之前的行為 */
export function policyOf(p: { versionPolicy?: VersionPolicy } | null | undefined): VersionPolicy {
  return p?.versionPolicy === "strict" ? "strict" : "loose";
}

/**
 * 版號格式檢查。
 *
 * `loose` 這一段刻意寬鬆 —— 只擋掉「一定會出問題」的，不強迫 semver。
 * 有人用 v1.2.3、有人用 2026.08、有人用 R42。硬要 semver 只會讓使用者
 * 為了通過驗證去改自己的慣例，那是工具越權。
 *
 * `strict` 是專案自己選進來的：選了之後 X/YY/ZZ 各自有取號條件，
 * 格式就不再只是外觀，而是規則的載體。
 */
export function checkVersionFormat(raw: string, policy: VersionPolicy = "loose"): VersionCheck {
  const v = raw.trim();
  if (!v) return { ok: false, reason: "版號不能空白 —— 這個欄位只有你能決定" };

  if (policy === "strict") {
    if (!VERSION_RE.test(v)) {
      return { ok: false, reason: "這個專案採 vX.YY.ZZ，YY 與 ZZ 要補到兩位（例如 v1.02.00）" };
    }
    return { ok: true };
  }

  if (v.length > 40) return { ok: false, reason: "版號太長（上限 40 字）" };
  if (/\s/.test(v)) return { ok: false, reason: "版號中間不要有空白" };
  // git tag 不接受這些字元；就算不打 tag，路徑與檔名也會出事
  if (/[~^:?*[\]\\/@{}]/.test(v)) return { ok: false, reason: "版號不能包含 ~ ^ : ? * [ ] \\ / @ { }" };
  if (/^[.-]|[.-]$/.test(v)) return { ok: false, reason: "版號不要以 . 或 - 開頭／結尾" };
  return { ok: true };
}

/** 同一個專案裡不能有兩個一樣的版號（忽略大小寫） */
export function isVersionTaken(
  version: string,
  projectId: string,
  releases: readonly Release[],
  exceptId?: string,
): boolean {
  const v = version.trim().toLowerCase();
  return releases.some(
    (r) => r.projectId === projectId && r.id !== exceptId && r.version.trim().toLowerCase() === v,
  );
}

export function validateVersion(
  version: string,
  projectId: string,
  releases: readonly Release[],
  exceptId?: string,
  policy: VersionPolicy = "loose",
): VersionCheck {
  const fmt = checkVersionFormat(version, policy);
  if (!fmt.ok) return fmt;
  if (isVersionTaken(version, projectId, releases, exceptId)) {
    return { ok: false, reason: `版號「${version.trim()}」已經用過了` };
  }
  return { ok: true };
}

/**
 * 上一個版號 —— **只作為參照顯示，不拿來自動填**。
 * 依建立時間取最新的，不做版號大小比較：使用者的編號慣例不一定可比較。
 */
export function lastVersionOf(projectId: string, releases: readonly Release[]): string | null {
  const mine = releases
    .filter((r) => r.projectId === projectId)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return mine[0]?.version ?? null;
}

// ── 統計 ────────────────────────────────────────────────────────

export type ReleaseProgress = { done: number; planned: number; total: number; pct: number };

export function releaseProgress(r: Release): ReleaseProgress {
  const done = r.items.filter((i) => i.state === "done").length;
  const total = r.items.length;
  return {
    done,
    planned: total - done,
    total,
    pct: total ? Math.round((done / total) * 100) : 0,
  };
}

// ── 送交執行用的交辦單 ──────────────────────────────────────────

/**
 * 交辦單。給人讀也給 agent 讀，所以用 markdown 而不是 JSON ——
 * agent 讀 markdown 沒問題，人讀 JSON 很痛苦。
 *
 * 尚未開發的項目排在前面：那才是要交辦出去做的事。已完成的放後面當範圍說明。
 */
export function buildHandoff(r: Release, projectTitle: string): string {
  const p = releaseProgress(r);
  const planned = r.items.filter((i) => i.state === "planned");
  const done = r.items.filter((i) => i.state === "done");
  // openspec change 印出目錄而不是裸名稱 —— 交辦出去的 agent 才知道去哪裡讀
  // proposal 與 tasks，那兩份才是它真正要照著做的東西
  const line = (i: ReleaseItem) => {
    const ref =
      i.source === "change" && i.ref
        ? `　\`openspec/changes/${i.ref}/\``
        : i.ref
          ? `　\`${i.ref}\``
          : "";
    return `- [${i.state === "done" ? "x" : " "}] ${i.text}${ref}`;
  };

  return [
    `# 版本交辦：${r.version}${r.title ? ` — ${r.title}` : ""}`,
    "",
    `**專案**：${projectTitle}`,
    `**版號**：${r.version}（由使用者指定）`,
    `**進度**：${p.done}/${p.total} 已完成（${p.pct}%）`,
    "",
    ...(r.note.trim() ? ["## 版本說明", "", r.note.trim(), ""] : []),
    "## 待開發（這次要做的）",
    "",
    ...(planned.length ? planned.map(line) : ["（無）"]),
    "",
    "## 已完成（本版範圍內，已經做好的）",
    "",
    ...(done.length ? done.map(line) : ["（無）"]),
    "",
    "## 完成後",
    "",
    `- 全部待開發項目勾完後，用 \`git tag -a ${r.version} -m '${r.version}'\` 標版`,
    "- 版號由使用者決定，不要自行改動或遞增",
  ].join("\n");
}

/** 新建一筆草稿。版號留白 —— 由使用者填，這裡不預設任何值。 */
export function draftRelease(projectId: string, id: string, now: string): Release {
  return {
    id,
    projectId,
    version: "",
    title: "",
    note: "",
    status: "draft",
    items: [],
    createdAt: now,
    updatedAt: now,
    handedAt: null,
  };
}
