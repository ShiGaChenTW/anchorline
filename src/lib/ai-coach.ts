import { store } from "../data/store";
import type { AISettings, Section } from "../data/types";

export type AICritique = {
  score: number;
  grade: "S" | "A" | "B" | "C";
  summary: string;
  strengths: string[];
  warnings: string[];
  suggestions: string[];
  suggestedPatch?: Record<string, string>;
};

const VAGUE_TERMS = ["優化", "儘快", "盡快", "大幅", "適當", "良好", "提升體驗", "更好", "儘可能"];

export async function critiqueSectionWithAI(
  section: Section,
  values: Record<string, string>,
  settings: AISettings,
): Promise<AICritique> {
  const text = Object.values(values).join("\n");
  const warnings: string[] = [];
  const strengths: string[] = [];
  const suggestions: string[] = [];

  // Vague term linter
  if (settings.enableLinters.warnVagueTerms) {
    const foundVague = VAGUE_TERMS.filter((w) => text.includes(w));
    if (foundVague.length > 0) {
      warnings.push(`檢測到模糊描述詞：${foundVague.map((w) => `「${w}」`).join("、")}。建議替換為量化數據或可驗收標準。`);
    }
  }

  // Section specific checks
  if (section.id === "summary") {
    if ((values.what || "").length > 10) strengths.push("交付物描述明確。");
    if (!values.why || values.why.length < 20) {
      warnings.push("「為何現在」時機論述較薄弱，建議補上外部客戶資安審查或市場競爭壓力。");
      suggestions.push("補充具體合約金額或 SOC 2 合規期限。");
    }
  } else if (section.id === "goals") {
    if (settings.enableLinters.requireNonGoals && (!values.nongoals || values.nongoals.length < 15)) {
      warnings.push("缺少足夠的非目標（Non-goals），容易導致範疇漫延（Scope Creep）。");
      suggestions.push("建議明確標註：「不包含簡訊 OTP」或「不包含免費方案強制」。");
    }
  } else if (section.id === "metrics") {
    if (settings.enableLinters.requireMetrics && !/\d+%|\d+天|\d+週|歸零/.test(text)) {
      warnings.push("成功指標缺少具體數字目標。");
      suggestions.push("加上明確數量目標，如：覆蓋率 ≥ 80%、阻擋項歸零。");
    }
  } else if (section.id === "stories") {
    if (!text.includes("作為") || !text.includes("以便")) {
      warnings.push("使用者故事未完全採用 As-a / I-want / So-that 規範。");
    }
  }

  let baseScore = section.score;
  if (warnings.length > 0) baseScore -= warnings.length * 7;
  if (strengths.length > 0) baseScore += strengths.length * 5;
  const score = Math.max(30, Math.min(98, baseScore));

  const grade = score >= 90 ? "S" : score >= 80 ? "A" : score >= 65 ? "B" : "C";
  const personaPrefix =
    settings.persona === "executive"
      ? "【高階審閱視角】"
      : settings.persona === "technical"
        ? "【架構師視角】"
        : settings.persona === "concise"
          ? "【極簡寫作視角】"
          : "【詳細規格視角】";

  return {
    score,
    grade,
    summary: `${personaPrefix} ${
      score >= 85
        ? "本章邏輯清晰，已達送審門檻。"
        : score >= 70
          ? "結構良好，補強建議項後即可送出。"
          : "尚有關鍵細節未補齊，建議使用 AI 生稿助教。"
    }`,
    strengths: strengths.length > 0 ? strengths : ["章節骨架完整"],
    warnings: warnings.length > 0 ? warnings : ["無顯著寫作缺陷"],
    suggestions: suggestions.length > 0 ? suggestions : ["可進下一章節或安排跨團隊簽核"],
  };
}

export async function generateAIDraft(
  section: Section,
  _currentValues: Record<string, string>,
  prompt?: string,
): Promise<Record<string, string>> {
  // Simulate AI latency for responsive feedback UI
  await new Promise((res) => setTimeout(res, 400));
  const settings = store.get().settings;
  const patch: Record<string, string> = {};

  if (section.id === "summary") {
    patch.what = "在 Northwind SaaS 系統中全面導入 TOTP (Authenticator App) 與 WebAuthn 雙重驗證機制，並支援團隊強制政策與復原金鑰。";
    patch.who = "企業租戶管理員 (Admins)、一般成員與資安合規稽核員。";
    patch.why = "近兩季有 3 筆 Enterprise 合約因缺少 2FA 卡在資安審查；補齊後可解除 $420k ARR 簽約阻礙並達成 SOC 2 Type II 控制點。";
  } else if (section.id === "problem") {
    patch.problem = "現有單一密碼驗證容易遭受釣魚與憑證填充攻擊。隨著大型企業租戶增加，缺少 2FA 成為資安問卷主要阻擋項，同時內部營運團隊缺乏分級存取態勢，造成合規威脅。";
    patch.quote = "「我們的資安政策強制要求所有 Vendor 支援 TOTP，若 Q4 前未上線將暫停續約。」— Enterprise 客戶資安總監";
  } else if (section.id === "goals") {
    patch.goals = "• 所有付費方案支援 TOTP (Google Authenticator / Authy / 1Password)\n• Enterprise 方案支援 WebAuthn 硬體金鑰\n• 提供一次性 10 組復原碼與稽核日誌記錄";
    patch.nongoals = "• 暫不支援簡訊 / 語音 OTP (避免 SIM Swap 威脅與簡訊通道成本)\n• 暫不支援免費方案強制啟用 2FA\n• 暫不修改 SSO/SAML 現有驗證流";
  } else if (section.id === "metrics") {
    patch.m1 = "指標 | 目標 | 量測方式\n---|---|---\n企業租戶啟用率 | GA 後 90 天內 ≥ 80% | 後端啟用事件統計\n資安阻擋項 | 兩季內降至 0 件 | 銷售與資安追蹤單\n設定完成率 | 啟動設定者 ≥ 75% | 驗證步驟完成漏斗";
  } else if (section.id === "stories") {
    patch.stories = "1. 作為成員，我想要綁定 TOTP，以便在密碼洩露時保護帳號安全。\n2. 作為工作區管理員，我想要強制全員啟用 2FA，以便符合公司資安規範。\n3. 作為遺失手機的使用者，我想要輸入復原碼登入，以便不中斷緊急工作。";
  } else if (section.id === "scope") {
    patch.ms = "M1 自願啟用 (3 週) — TOTP 綁定與登入驗證\nM2 復原碼與日誌 (2 週) — 復原碼產生與稽核日誌\nM3 管理員強制 (2 週) — 工作區寬限期與鎖定機制\nM4 WebAuthn (3 週) — 硬體金鑰支援";
  } else if (section.id === "open") {
    patch.oq = "• 強制啟用 2FA 的預設寬限期為 7 天或 14 天？— 林可晴 (8/10 前拍板)\n• 復原碼用盡後的解鎖流程是否走人工審核？— 周承翰 (8/12 前確認)";
  }

  if (prompt) {
    // Custom prompt polish
    for (const k in patch) {
      if (settings.persona === "concise") {
        patch[k] = patch[k].split("\n").map((line) => line.trim()).join("\n");
      } else if (settings.persona === "technical") {
        patch[k] += `\n(技術附註：基於 RFC 6238 TOTP 規格與 FIDO2/WebAuthn API)`;
      }
    }
  }

  return patch;
}

export async function polishTextWithAI(
  text: string,
  mode: "concise" | "executive" | "technical" | "add_metrics",
): Promise<string> {
  await new Promise((res) => setTimeout(res, 300));
  if (!text) return text;

  if (mode === "concise") {
    return text
      .replace(/並且|另外|同時|除此之外/g, "；")
      .replace(/進行|實作|處理/g, "")
      .trim();
  }
  if (mode === "executive") {
    return `【高階摘要】${text}\n核心效益：提升合規覆蓋率、降低企業續約風險與資安潛在損失。`;
  }
  if (mode === "technical") {
    return `${text}\n[架構規範] 需具備冪等性 (Idempotent)、符合 OWASP Top 10 防護與端到端加密。`;
  }
  if (mode === "add_metrics") {
    return `${text}\n[量化指標] 預期完成率 ≥ 85%，SLO 響應時間 < 150ms。`;
  }
  return text;
}
