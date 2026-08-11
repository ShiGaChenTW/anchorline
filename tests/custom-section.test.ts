/**
 * 「XX 自訂章節」＝ 範本插入的統一去處。
 *
 * 這一節不是領域包的產物，是骨架解析完之後才追加的，所以它的兩個性質
 * （永遠在最後、編號接在最後一章之後）在程式裡沒有第二個地方保證。
 */
import { describe, expect, test } from "bun:test";
import { CUSTOM_SECTION_ID, SEED_SECTIONS, withCustomSection } from "../src/data/seed";
import { BASE_GATE_SPEC, evaluatePrdGates } from "../src/lib/prd-gates";
import { buildOpenspecPrd } from "../src/lib/export";
import type { AppState, Section } from "../src/data/types";

describe("withCustomSection", () => {
  test("接在最後，編號是最後一章 + 1", () => {
    const out = withCustomSection(SEED_SECTIONS);
    const last = out[out.length - 1];
    expect(last.id).toBe(CUSTOM_SECTION_ID);
    expect(last.n).toBe(String(SEED_SECTIONS.length + 1).padStart(2, "0"));
    expect(last.title).toBe("自訂章節");
  });

  test("領域包多幾章，編號就跟著往後 —— 不是寫死的 09", () => {
    const extra: Section[] = [...SEED_SECTIONS, { ...SEED_SECTIONS[0], id: "x1", n: "99" }];
    expect(withCustomSection(extra)[extra.length].n).toBe(
      String(extra.length + 1).padStart(2, "0"),
    );
  });

  test("重複呼叫不會長出第二節", () => {
    const once = withCustomSection(SEED_SECTIONS);
    expect(withCustomSection(once)).toHaveLength(once.length);
  });

  test("有一個可寫入的欄位 —— 沒有欄位的話範本插進去會靜靜消失", () => {
    const s = withCustomSection(SEED_SECTIONS).at(-1)!;
    expect(s.fields.length).toBeGreaterThan(0);
    expect(s.fields[0].type).toBe("textarea");
  });
});

describe("gate 與自訂章節", () => {
  test("空白的自訂章節不算進「空白章節數」", () => {
    const base = withCustomSection(SEED_SECTIONS).map((s) => ({ ...s, status: "done" as const }));
    const state = (sections: Section[]) =>
      ({ sections, sectionValues: {} }) as unknown as AppState;

    const allDone = evaluatePrdGates(state(base), BASE_GATE_SPEC);
    const customEmpty = evaluatePrdGates(
      state(base.map((s) => (s.id === CUSTOM_SECTION_ID ? { ...s, status: "empty" as const } : s))),
      BASE_GATE_SPEC,
    );
    expect(customEmpty.warns).toBe(allDone.warns);
  });
});

describe("匯出 OpenSpec PRD", () => {
  const sections = withCustomSection(SEED_SECTIONS);
  const state = (values: Record<string, Record<string, string>>) =>
    ({
      sections,
      sectionValues: values,
      projects: [],
      currentUser: { name: "測試", accessRole: "admin" },
    }) as unknown as AppState;

  test("自訂章節的內容進 Appendix，不混進 Technical Specifications", () => {
    const md = buildOpenspecPrd(state({ [CUSTOM_SECTION_ID]: { body: "插進來的範本段落" } }));
    expect(md).toContain("## Appendix");
    expect(md).toContain("插進來的範本段落");
    const techBlock = md.slice(
      md.indexOf("## Technical Specifications"),
      md.indexOf("## Risks & Roadmap"),
    );
    expect(techBlock).not.toContain("插進來的範本段落");
  });

  test("自訂章節空白時不留一個空的 Appendix 標題", () => {
    expect(buildOpenspecPrd(state({}))).not.toContain("## Appendix");
  });
});
