import { describe, expect, test } from "bun:test";
import { extractJsonObject, gradeFromScore } from "../src/lib/ai-shared";
import { SCHEMA_EXAMPLE } from "../src/lib/domain-pack-author";
import { validatePackStructure } from "../src/lib/domain-pack";

describe("extractJsonObject", () => {
  test("裸 JSON", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  test("```json 圍欄", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  test("前後夾雜說明文字", () => {
    expect(extractJsonObject('好的，結果如下：\n{"a":"x"}\n以上。')).toEqual({ a: "x" });
  });

  test("巢狀物件取最外層大括號", () => {
    expect(extractJsonObject('{"a":{"b":2}}')).toEqual({ a: { b: 2 } });
  });

  test("沒有大括號 → null", () => {
    expect(extractJsonObject("純文字回答")).toBeNull();
  });

  test("大括號內不是合法 JSON → null", () => {
    expect(extractJsonObject("{a: 不合法}")).toBeNull();
  });
});

describe("gradeFromScore", () => {
  test("門檻與本機評估一致：≥90 S / ≥80 A / ≥65 B / 其餘 C", () => {
    expect(gradeFromScore(100)).toBe("S");
    expect(gradeFromScore(90)).toBe("S");
    expect(gradeFromScore(89)).toBe("A");
    expect(gradeFromScore(80)).toBe("A");
    expect(gradeFromScore(79)).toBe("B");
    expect(gradeFromScore(65)).toBe("B");
    expect(gradeFromScore(64)).toBe("C");
    expect(gradeFromScore(0)).toBe("C");
  });
});

describe("SCHEMA_EXAMPLE", () => {
  test("教模型格式的範例自己必須驗得過", () => {
    const r = validatePackStructure(SCHEMA_EXAMPLE, "SCHEMA 範例");
    expect(r.ok).toBe(true);
  });
});
