/**
 * 後端清單的**顯示邏輯** —— 設定頁與 agents 頁共用的那一半。
 *
 * 拆出來的理由不是好看，是可測：這兩張清單真正會出錯的地方（金鑰有沒有外洩到
 * 畫面上、CLI 偵測不到時說了什麼、綁定值跟實際解析結果不一致時有沒有講）
 * 全部是純資料轉換。留在 `innerHTML` 樣板裡的話，只能靠人開 App 用眼睛看。
 *
 * 純函式：不碰 DOM、不碰 store、不碰 `native`。探測結果由呼叫端餵進來。
 */
import type { AgentBackend, AgentCliTool } from "../data/types";
import { backendLabel, DEFAULT_BACKEND_ID } from "./agent-backend";

/** `native.probeClis()` 的形狀：工具 id → 找到的絕對路徑，找不到是 null */
export type CliPaths = Record<string, string | null>;

/**
 * 一個 CLI 工具在這台機器上的狀態。
 *
 * 四種分開，是因為使用者要做的事完全不同：瀏覽器要去開桌面版、`missing`
 * 要去裝或指路徑、`pending` 只要等。把它們併成一個 boolean，UI 就只能說
 * 「不可用」，而那句話沒有告訴任何人下一步。
 */
export type CliProbe =
  | { state: "unsupported" }
  | { state: "pending" }
  | { state: "found"; path: string }
  | { state: "missing" };

export function cliProbe(
  tool: AgentCliTool,
  probed: CliPaths | null,
  isNative: boolean,
): CliProbe {
  if (!isNative) return { state: "unsupported" };
  if (!probed) return { state: "pending" };
  const hit = probed[tool];
  return hit ? { state: "found", path: hit } : { state: "missing" };
}

/**
 * 探測結果講給人聽。
 *
 * `missing` 這句刻意講出「按下去會失敗」—— 使用者設定一個偵測不到的後端時
 * 唯一會犯的錯，就是以為它之後會自己找到。
 */
export function cliProbeNote(p: CliProbe, tool: AgentCliTool): string {
  switch (p.state) {
    case "unsupported":
      return "瀏覽器版沒有 CLI 通路。要用 CLI 後端請開桌面版 App。";
    case "pending":
      return "偵測中…";
    case "found":
      return `已偵測到：${p.path}`;
    case "missing":
      return `這台機器上找不到 ${tool}。現在呼叫這個後端會失敗 —— 請先安裝，或在下方指定完整路徑。`;
  }
}

/** 一筆後端在清單上的樣子。**這個型別裡沒有金鑰欄位，是刻意的** */
export type BackendRow = {
  id: string;
  label: string;
  kindLabel: string;
  /** 第二行的細節 */
  detail: string;
  /** default 的身分說明；其餘為 null */
  badge: string | null;
  isDefault: boolean;
  canRename: boolean;
  canDelete: boolean;
  /**
   * API 後端的金鑰**狀態**，不是金鑰。CLI 後端為 null。
   *
   * 只回 set/unset 是這一層的硬規定：畫面上不顯示既有金鑰明文，連長度都不給。
   * 「已設定」足以讓使用者判斷要不要重填，而那是他唯一需要知道的事。
   */
  keyState: "set" | "unset" | null;
};

export function backendRow(
  b: AgentBackend,
  probed: CliPaths | null,
  isNative: boolean,
): BackendRow {
  const isDefault = b.id === DEFAULT_BACKEND_ID;
  const base = {
    id: b.id,
    label: backendLabel(b),
    isDefault,
    // default 是全域 AI 設定的投影，不是清單裡的一筆資料 —— 改名等於替一份
    // 推導出來的東西取名字，刪除等於刪掉所有 agent 的回退目標。兩件都不成立。
    canRename: !isDefault,
    canDelete: !isDefault,
    badge: isDefault ? "預設（全域設定的投影）" : null,
  };
  if (b.kind === "cli") {
    return {
      ...base,
      kindLabel: "CLI",
      detail: cliProbeNote(cliProbe(b.tool, probed, isNative), b.tool),
      keyState: null,
    };
  }
  return {
    ...base,
    kindLabel: "API",
    detail: b.endpoint.trim() || "（未設端點，送出時用通路預設）",
    keyState: b.apiKey.trim() ? "set" : "unset",
  };
}

export function keyStateLabel(s: BackendRow["keyState"]): string {
  if (s === "set") return "金鑰已設定";
  if (s === "unset") return "尚未設定金鑰";
  return "";
}

/** agents 頁那顆下拉要顯示什麼 */
export type BackendBinding = {
  options: { value: string; label: string; selected: boolean }[];
  /** 這個 agent 實際會用的後端 */
  resolvedLabel: string;
  /**
   * 綁定值與實際解析結果對不上時的說明；對得上是 null。
   *
   * 會發生的情境只有一個：綁著的後端被刪了（`removeBackend` 擋得住「還被綁著
   * 就刪」，但備份匯入繞得過去）。`resolveBackend` 會安靜地回退到 default，
   * 而**安靜正是問題** —— 使用者以為自己在跑本機 CLI，實際上在燒 API 額度，
   * 那種錯誤沒有畫面症狀，月底看帳單才會發現。
   */
  warning: string | null;
};

export function backendBinding(
  boundId: string | null | undefined,
  backends: readonly AgentBackend[],
  resolved: AgentBackend,
): BackendBinding {
  const bound = (boundId ?? "").trim();
  const known = backends.some((b) => b.id === bound);
  const fallback = backends.find((b) => b.id === DEFAULT_BACKEND_ID) ?? resolved;
  const options = [
    {
      value: "",
      // 綁到一個已不存在的 id 時，這一項仍然是選中的 —— 因為那就是**實際發生的事**
      // （`resolveBackend` 已經回退了）。下拉顯示一個死掉的 id 會讓使用者以為它還活著；
      // 真正該講的話在 `warning` 裡。
      label: `跟隨預設（${backendLabel(fallback)}）`,
      selected: !bound || !known,
    },
    ...backends
      .filter((b) => b.id !== DEFAULT_BACKEND_ID)
      .map((b) => ({
        value: b.id,
        label: `${backendLabel(b)}（${b.kind === "cli" ? "CLI" : "API"}）`,
        selected: b.id === bound,
      })),
  ];
  const warning =
    bound && !known
      ? `這個 Agent 綁的後端「${bound}」已經不存在，目前實際跑的是「${backendLabel(resolved)}」。` +
        `請重新選一個，否則它會一直沿用預設後端（包含預設後端的金鑰與帳單）。`
      : null;
  return { options, resolvedLabel: backendLabel(resolved), warning };
}
