/**
 * `project.json`（`.anchorline/exports/`）是交接用的固定 schema，讀的人
 * 是人也是別的軟體——欄位缺席時要有可預期的預設值，不能忽高忽低。
 */
import { describe, expect, test } from "bun:test";
import { buildProjectProfile } from "../src/lib/export";
import type { Project } from "../src/data/types";

function baseProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    title: "測試專案",
    status: "draft",
    pct: 0,
    owner: "Scott",
    ownerId: "u1",
    authorId: "u1",
    mine: true,
    updated: "剛剛",
    tag: "product",
    ...overrides,
  };
}

describe("buildProjectProfile", () => {
  test("未設定的欄位落在文件裡承諾的預設值", () => {
    const p = buildProjectProfile(baseProject());
    expect(p.schema).toBe("anchorline.project-profile.v1");
    expect(p.shortCode).toBeNull();
    expect(p.versionPolicy).toBe("loose");
    expect(p.domain).toBe("generic");
    expect(p.description).toBeNull();
    expect(p.tags).toEqual([]);
  });

  test("名稱依 customName → title → sourceFolder 的順位（projectDisplayName）", () => {
    const p = buildProjectProfile(baseProject({ title: "標題", customName: "自訂名" }));
    expect(p.name).toBe("自訂名");
  });

  test("已設定的欄位原樣帶出，簡寫與版號政策是交接最在意的兩項", () => {
    const p = buildProjectProfile(
      baseProject({
        shortCode: "AL",
        versionPolicy: "strict",
        domain: "fintech",
        description: "  一句話介紹  ",
        tags: ["a", "b"],
      }),
    );
    expect(p.shortCode).toBe("AL");
    expect(p.versionPolicy).toBe("strict");
    expect(p.domain).toBe("fintech");
    expect(p.description).toBe("一句話介紹");
    expect(p.tags).toEqual(["a", "b"]);
  });
});
