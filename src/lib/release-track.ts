/**
 * 版號規則 —— 層級閘門與放行判定。純函式、零 I/O。
 *
 * ## 這些規則只在 `strict` 政策下生效
 *
 * 版號政策是**每個專案自己選一次**（`release.ts` 的 `VersionPolicy`）：
 * `loose` 維持原本的寬鬆檢查，`strict` 才走下面這套。
 * 選了 strict 就回不去 —— 理由寫在 `VersionPolicy` 的註解裡。
 *
 * ## strict：`vX.YY.ZZ`，三段各自有取號條件
 *
 * | 段 | 用途 | 取號條件 |
 * |---|---|---|
 * | `X` | 大型迭代 | 該專案要有完成的 PRD 簽核紀錄 |
 * | `YY` | 新功能，或集合多個 bug | 收的內容要有走過 OpenSpec 的 change |
 * | `ZZ` | 小修 | 直接挑 commit |
 *
 * YY 與 ZZ 固定兩位補零：`v1.00.00`、`v1.01.07`、`v2.00.00`。
 *
 * ## 取號與 PUSH 是兩件事（兩種政策都適用）
 *
 * 所有版號都可以**預先取號**用來規劃，號取了不代表東西出去了。
 * PUSH 一律要使用者明確放行。
 */
import type { Release, ReleaseItem, VersionPolicy } from "./release";

export type ReleaseLevel = "major" | "minor" | "patch";

export const LEVEL_LABEL: Record<ReleaseLevel, string> = {
  major: "大型迭代",
  minor: "新功能／集合修正",
  patch: "小修",
};

export const LEVEL_SEGMENT: Record<ReleaseLevel, string> = {
  major: "X",
  minor: "YY",
  patch: "ZZ",
};

export const LEVEL_BLURB: Record<ReleaseLevel, string> = {
  major: "動 X。要有這個專案完成的 PRD 簽核紀錄才能取號。",
  minor: "動 YY。收的內容必須走過 OpenSpec，至少一個 change。",
  patch: "動 ZZ。直接挑已經 commit 的項目。",
};

/** `vX.YY.ZZ` —— YY 與 ZZ 固定兩位補零 */
export const VERSION_RE = /^v(\d+)\.(\d{2})\.(\d{2})$/;

export type Semver = { major: number; minor: number; patch: number };

export function parseVersion(v: string): Semver | null {
  const m = VERSION_RE.exec(v.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function formatVersion(s: Semver): string {
  return `v${s.major}.${String(s.minor).padStart(2, "0")}.${String(s.patch).padStart(2, "0")}`;
}

/**
 * 依層級算出下一個版號。**這是建議值，不是自動指定** ——
 * 呼叫端要把它放進可編輯的欄位，最終決定仍然是使用者的。
 */
export function suggestNext(previous: string | null, level: ReleaseLevel): string {
  const p = (previous && parseVersion(previous)) || { major: 0, minor: 0, patch: 0 };
  if (level === "major") return formatVersion({ major: p.major + 1, minor: 0, patch: 0 });
  if (level === "minor") return formatVersion({ major: p.major, minor: p.minor + 1, patch: 0 });
  return formatVersion({ major: p.major, minor: p.minor, patch: p.patch + 1 });
}

/** 版號與宣告的層級一致嗎（相對於上一版動的是不是那一段） */
export function levelOfBump(previous: string | null, next: string): ReleaseLevel | null {
  const n = parseVersion(next);
  if (!n) return null;
  const p = (previous && parseVersion(previous)) || { major: 0, minor: 0, patch: 0 };
  if (n.major !== p.major) return "major";
  if (n.minor !== p.minor) return "minor";
  if (n.patch !== p.patch) return "patch";
  return null;
}

// ── 取號閘門 ────────────────────────────────────────────────────

/**
 * 閘門要的外部事實，由呼叫端從 store 與 openspec CLI 餵進來。
 * 判定留在這裡才測得動。
 */
export type GateFacts = {
  /** 這個專案有沒有「全部必簽關卡通過且已合併」的 PRD 版本 */
  hasApprovedPrd: boolean;
  /** 這一版目前收了哪些項目 */
  items: readonly Pick<ReleaseItem, "source" | "ref">[];
};

export type GateResult = { ok: true } | { ok: false; reason: string; fix: string };

/**
 * 這個層級現在能不能取號。
 *
 * 每一種擋法都要說得出**下一步**：擋下來卻只說「不符合條件」，
 * 使用者會去猜，而猜錯的成本是他改了不該改的東西。
 */
export function levelGate(level: ReleaseLevel, facts: GateFacts): GateResult {
  if (level === "major") {
    if (!facts.hasApprovedPrd) {
      return {
        ok: false,
        reason: "大型迭代要有這個專案完成的 PRD 簽核紀錄。",
        fix: "先把 PRD 送審並讓必簽關卡全部通過，核准後會合併回主線。",
      };
    }
    return { ok: true };
  }

  if (level === "minor") {
    const hasChange = facts.items.some((i) => i.source === "change" && i.ref);
    if (!hasChange) {
      return {
        ok: false,
        reason: "新功能版要走過 OpenSpec，這一版還沒有收任何 change。",
        fix: "到 OpenSpec 入口建立 change，實作完再回來把它收進這一版。",
      };
    }
    return { ok: true };
  }

  // patch：挑 commit 就好，沒有額外條件
  if (!facts.items.length) {
    return {
      ok: false,
      reason: "這一版還沒有收任何項目。",
      fix: "從候選清單挑已經 commit 的項目。",
    };
  }
  return { ok: true };
}

// ── commit 佔用 ─────────────────────────────────────────────────

/**
 * 誰佔用了這個 ref。同一筆 commit 只能被一個版號收 ——
 * 落在兩份 release note 裡，讀的人無從判斷它屬於哪一版。
 *
 * `exceptId` 一定要傳自己那一版，否則編輯中的版號會說自己佔用了自己。
 */
export function refOwner(
  ref: string,
  projectId: string,
  releases: readonly Release[],
  exceptId?: string,
): Release | null {
  return (
    releases.find(
      (r) => r.projectId === projectId && r.id !== exceptId && r.items.some((i) => i.ref === ref),
    ) ?? null
  );
}

export function claimedRefs(
  projectId: string,
  releases: readonly Release[],
  exceptId?: string,
): Set<string> {
  const out = new Set<string>();
  for (const r of releases) {
    if (r.projectId !== projectId || r.id === exceptId) continue;
    for (const i of r.items) if (i.ref) out.add(i.ref);
  }
  return out;
}

export type AddCheck = { ok: true } | { ok: false; reason: string };

export function canAddItem(
  release: Release,
  candidate: Pick<ReleaseItem, "source" | "ref">,
  allReleases: readonly Release[],
): AddCheck {
  if (release.releasedAt) {
    return { ok: false, reason: "這一版已經放行，內容不能再改。" };
  }
  if (candidate.ref) {
    const owner = refOwner(candidate.ref, release.projectId, allReleases, release.id);
    if (owner) {
      return { ok: false, reason: `這一筆已經被版號「${owner.version || "（未命名）"}」收走了。` };
    }
  }
  return { ok: true };
}

// ── 放行與 PUSH ─────────────────────────────────────────────────

export type PushGate =
  | { ok: true; command: string }
  | { ok: false; reason: string; fix: string };

/**
 * 現在能不能 PUSH。
 *
 * **取號 ≠ 放行。** 所有層級都可以先取號規劃，號在那裡不代表東西出去了。
 * 要 PUSH 必須：版號合法 → 層級閘門過 → 使用者明確放行。
 *
 * 放行是一個獨立動作而不是自動推導，因為 push 出去收不回來 ——
 * 那個決定要有一個明確的按下去的瞬間。
 */
export function pushGate(
  release: Release,
  facts: GateFacts,
  policy: VersionPolicy = "strict",
): PushGate {
  const v = release.version.trim();
  if (!v) {
    return { ok: false, reason: "還沒有版號。", fix: "在上面的欄位填一個。" };
  }
  // loose 的版號沒有段落語意，所以沒有層級閘門可套 —— 只看有沒有放行
  if (policy === "strict") {
    if (!parseVersion(v)) {
      return { ok: false, reason: "版號格式不符 vX.YY.ZZ。", fix: "例如 v1.02.00，YY 與 ZZ 補到兩位。" };
    }
    if (release.level) {
      const g = levelGate(release.level, facts);
      if (!g.ok) return { ok: false, reason: g.reason, fix: g.fix };
    }
  }
  if (!release.releasedAt) {
    return {
      ok: false,
      reason: "這一版還沒放行。取號是規劃，放行才是「要出去了」。",
      fix: "確認內容無誤後按「正式放行」。",
    };
  }
  return { ok: true, command: tagCommand(v) };
}

/** 只產生，不執行 —— push 出去收不回來，那個決定留給人。 */
export function tagCommand(version: string): string {
  const v = version.trim();
  return `git tag -a ${v} -m ${JSON.stringify(v)}\ngit push origin ${v}`;
}
