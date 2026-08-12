/**
 * AI 味檢查 —— 純函式，零 I/O。
 *
 * ## 依據：HelmDeck 實測樣本（2026-08-12）
 *
 * AI 生成的 PRD 被抱怨「非常難閱讀」。讀了實際樣本之後，診斷跟直覺相反：
 * 問題**不是空話** —— 事實密度其實很高 —— 是**結構**：
 *
 * - goals 一個欄位 2,440 字，完全不分段
 * - 單一條列項 300 字，結論埋在第三個子句後面
 * - 「——」與括號巢狀的長句，一句塞三個從句
 * - 每個欄位一樣的高密度節奏，讀者沒有地方換氣
 *
 * 所以這裡的檢查以**結構**為主（長句、不分段、超長條列），
 * 詞面的樣板語（旨在、賦能…）為輔。詞可以避，節奏很難裝。
 */

/**
 * 樣板語。這一份跟 `VAGUE_TERMS`（模糊詞）是兩回事：
 * 模糊詞是「說了等於沒說」，樣板語是「一看就是機器寫的」。
 */
export const AI_TELL_TERMS = [
  "旨在",
  "致力於",
  "賦能",
  "無縫",
  "一站式",
  "全方位",
  "綜上所述",
  "值得注意的是",
  "在當今",
  "隨著科技的發展",
  "扮演著重要角色",
  "不可或缺",
] as const;

/** 一句超過這個字數（中間沒有句號級標點）就該拆 */
export const LONG_SENTENCE = 80;
/** 一個欄位超過這個字數卻沒有空行分段，就是一面牆 */
export const WALL_OF_TEXT = 400;
/** 單一條列項超過這個字數，結論就埋掉了 */
export const LONG_BULLET = 150;

export type AiTellFinding = {
  kind: "term" | "long-sentence" | "wall" | "long-bullet";
  message: string;
};

/** 把 markdown 條列前綴拿掉後的「一行」 */
function bulletBody(line: string): string | null {
  const m = /^\s*(?:[-•*]|\d+[.)、])\s+(.*)$/.exec(line);
  return m ? m[1]! : null;
}

export function aiTellFindings(text: string): AiTellFinding[] {
  const out: AiTellFinding[] = [];
  const t = text.trim();
  if (!t) return out;

  const hitTerms = AI_TELL_TERMS.filter((w) => t.includes(w));
  if (hitTerms.length) {
    out.push({
      kind: "term",
      message: `AI 樣板語：${hitTerms.map((w) => `「${w}」`).join("、")}。這些詞不帶資訊，刪掉句子通常更清楚。`,
    });
  }

  // 「不僅…更…」排比：詞表抓不到，因為它是兩個分開的字
  if (/不僅[^。！？\n]{0,40}更/.test(t)) {
    out.push({
      kind: "term",
      message: "「不僅…更…」排比是 AI 慣用句式。拆成兩句，或只留重要的那一半。",
    });
  }

  // 長句：以句號級標點切開後，單段超過上限。頓號、逗號不算斷句 ——
  // 一路逗號串到底正是要抓的東西
  const sentences = t.split(/[。！？!?\n]/);
  const longs = sentences.filter((s) => s.replace(/\s/g, "").length > LONG_SENTENCE);
  if (longs.length) {
    out.push({
      kind: "long-sentence",
      message: `有 ${longs.length} 句超過 ${LONG_SENTENCE} 字沒斷句。一句一個意思，超過就拆。`,
    });
  }

  // 一面牆：夠長卻沒有任何空行
  if (t.length > WALL_OF_TEXT && !/\n\s*\n/.test(t)) {
    out.push({
      kind: "wall",
      message: `${t.length} 字沒有分段。每 2–3 句空一行，讀者需要換氣的地方。`,
    });
  }

  // 超長條列項
  const longBullets = t
    .split("\n")
    .map(bulletBody)
    .filter((b): b is string => b !== null && b.length > LONG_BULLET);
  if (longBullets.length) {
    out.push({
      kind: "long-bullet",
      message: `有 ${longBullets.length} 個條列項超過 ${LONG_BULLET} 字。條列是給掃視用的 —— 先一句結論，細節放子條列或改成段落。`,
    });
  }

  return out;
}

/**
 * 寫作紀律 —— 疊進生成 prompt 的那一段。
 *
 * 跟 `aiTellFindings` 是同一套標準的兩面：這裡叫模型別犯，
 * 那裡在模型犯了之後抓出來。改標準要兩邊一起改，所以放同一個檔。
 */
export const WRITING_DISCIPLINE = `Writing discipline (成品是給人讀的，不是給評審湊字數的):
- 一句一個意思。超過 ${LONG_SENTENCE} 字就拆句。少用「——」與括號插敘；插敘重要就獨立成句，不重要就刪。
- 條列單項不超過兩行。細節多的項目：先一句結論，細節放子條列。
- 每 2–3 句空一行分段。欄位之間長度不必一致 —— 一句話能講完的欄位就寫一句話。
- 禁用：${AI_TELL_TERMS.join("、")}、「不僅…更…」排比。
- 寧短勿滿。沒有具體事實（檔名、數字、角色、行為）可寫時就停，不用概念句填長度。`;

/**
 * 出廠語氣樣本 —— 使用者沒設定 styleSample 時的預設錨點。
 *
 * 刻意寫成「有長有短、有段落有條列」：模型模仿的是節奏，
 * 不是內容。內容用跟種子資料同一個假想案（Northwind 2FA），
 * 才不會把別的領域的術語帶進使用者的 PRD。
 */
export const DEFAULT_STYLE_SAMPLE = `企業客戶的資安審查一直卡在同一條：登入只有密碼。近六次審查有三次把它列為阻擋項。

這次補上第二因素。範圍很窄：TOTP 加上 WebAuthn，掛在既有的登入流程上，不動 SSO。

不做的事也先講清楚：
- 不做簡訊 OTP —— SIM 交換風險，而且每則都要錢
- 不做自建 Authenticator App

風險只有一個值得寫：復原碼被抄走等於繞過整套 2FA。所以復原碼一次一用，用過即廢。`;
