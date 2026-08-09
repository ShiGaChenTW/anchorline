/**
 * AI 產出領域包的驗證層。
 *
 * 這裡不測「模型寫得好不好」——那不是測試能回答的問題。測的是
 * **不合格的產出會不會被擋下來**：LLM 產生一份看起來很像樣、實際上規則指向
 * 不存在欄位的領域包，是這條路上最可能發生也最難察覺的失效。
 *
 * `authorDomainPack` 本身要打網路，不在這裡測；`validate` 是純函式，
 * 而且它就是那道閘門。
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validatePackStructure as validate } from "../src/lib/domain-pack";
import { authorDomainPack } from "../src/lib/domain-pack-author";

const OK = `---
name: insurance
displayName: 保險 / 保代
extends: _base
prompt: |
  台灣產險 PRD。需涵蓋保險法第 148 條之揭露義務。
sections:
  - id: policy_terms
    n: "08"
    title: 保單條款要點
    fields:
      - key: exclusions
        label: 不保事項
        type: textarea
gates:
  - rules:
      - id: ins-exclusions
        level: block
        label: 未列不保事項
        detail: 目前 {count} 條
        section: policy_terms
        fields: [exclusions]
        require: { kind: bullets, min: 2 }
    pass: { id: ins-exclusions-ok, label: 不保事項已列, detail: ok }
---
`;

function tweak(replacements: [string, string][]): string {
  return replacements.reduce((s, [a, b]) => s.replace(a, b), OK);
}

describe("validate — 收下之前擋掉什麼", () => {
  test("合格的產出通過，並回傳解析後的包", () => {
    const v = validate(OK);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.pack.name).toBe("insurance");
  });

  test("內建範本自己也通過（除了它保留的 _ 前綴）", () => {
    const raw = readFileSync(join(import.meta.dir, "../src/data/domains/_template.md"), "utf8");
    const v = validate(raw);
    // _template 刻意用 _ 開頭，所以應該被那一條擋下——其餘結構必須是對的
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("_ 開頭");
  });

  test("缺 frontmatter / 壞 YAML → 擋下", () => {
    expect(validate("# 只是一段散文").ok).toBe(false);
    expect(validate("---\nname: [壞掉\n---\n").ok).toBe(false);
  });

  test("name 用 _ 開頭 → 擋下（那是內部保留前綴，會從選單消失）", () => {
    const v = validate(tweak([["name: insurance", "name: _insurance"]]));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("_ 開頭");
  });

  test("規則指向不存在的章節 → 擋下（LLM 最常犯的錯）", () => {
    const v = validate(tweak([["section: policy_terms", "section: 不存在的章節"]]));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("不存在的章節");
  });

  test("規則指向不存在的欄位 → 擋下", () => {
    const v = validate(tweak([["fields: [exclusions]", "fields: [不存在的欄位]"]]));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("不存在的欄位");
  });

  test("規則 id 重複 → 擋下", () => {
    const dup = OK.replace(
      "    pass: { id: ins-exclusions-ok, label: 不保事項已列, detail: ok }",
      `  - rules:
      - id: ins-exclusions
        level: warn
        label: 重複的 id
        detail: x
        section: policy_terms
        require: { kind: minLength, n: 5 }`,
    );
    const v = validate(dup);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("重複");
  });

  test("pass id 撞到規則 id → 擋下", () => {
    const v = validate(tweak([["id: ins-exclusions-ok", "id: ins-exclusions"]]));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("重複");
  });

  test("無效的正規表達式 → 擋下", () => {
    const v = validate(
      tweak([["require: { kind: bullets, min: 2 }", 'require: { kind: match, re: "([壞掉" }']]),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("正規表達式");
  });

  test("hints 也一樣受檢 — 不擋簽核不代表可以亂寫", () => {
    const withBadHint = `${OK.slice(0, OK.lastIndexOf("---"))}hints:
  - rules:
      - id: h1
        level: warn
        label: x
        detail: x
        section: 不存在
        require: { kind: minLength, n: 5 }
---
`;
    const v = validate(withBadHint);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("不存在");
  });
});

// ── 產生迴圈：驗不過就把錯誤餵回去修一次 ──────────────────────

describe("authorDomainPack", () => {
  const bad = OK.replace("section: policy_terms", "section: 不存在的章節");

  test("一次就合格 → 不重試", async () => {
    const calls: string[] = [];
    const r = await authorDomainPack({ brief: "產險" }, async (_s, u) => {
      calls.push(u);
      return OK;
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.repaired).toBe(false);
    expect(calls).toHaveLength(1);
  });

  test("第一次驗不過 → 把錯誤原文餵回去，第二次過", async () => {
    const seen: string[] = [];
    let n = 0;
    const r = await authorDomainPack({ brief: "產險" }, async (_s, u) => {
      seen.push(u);
      return n++ === 0 ? bad : OK;
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.repaired).toBe(true);
    expect(seen).toHaveLength(2);
    // 修正提示必須帶上真正的錯誤原因，不然模型只是再猜一次
    expect(seen[1]).toContain("不存在的章節");
    expect(seen[1]).toContain("不要解釋");
  });

  test("修了還是不過 → 誠實失敗，但把原文還給使用者手改", async () => {
    let n = 0;
    const r = await authorDomainPack({ brief: "產險" }, async () => (n++, bad));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("修正後仍無法解析");
      // stripFence 會 trim（模型常帶尾隨空白），所以比 trim 後的
      expect(r.raw).toBe(bad.trim()); // 丟掉太浪費，多半手改一行就能用
    }
    expect(n).toBe(2); // 只修一次，不無限重試
  });

  test("模型加了 ``` 圍欄也照樣收（叫它不要它還是會加）", async () => {
    const r = await authorDomainPack({ brief: "產險" }, async () => "```markdown\n" + OK + "```");
    expect(r.ok).toBe(true);
  });

  test("網路錯誤原樣回報，不假裝成解析失敗", async () => {
    const r = await authorDomainPack({ brief: "產險" }, async () => {
      throw new Error("Anthropic 錯誤 (401)");
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("401");
  });

  test("迭代時帶上前一版與修改指示，並要求輸出完整檔案", async () => {
    let user = "";
    await authorDomainPack({ brief: "產險", prior: OK, instruction: "把那條改成 warn" }, async (_s, u) => {
      user = u;
      return OK;
    });
    expect(user).toContain("ins-exclusions"); // 前一版在裡面
    expect(user).toContain("把那條改成 warn");
    expect(user).toContain("不要只給差異");
  });
});
