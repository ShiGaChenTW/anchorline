/**
 * PRD 檔案落地的純邏輯。
 *
 * 守的是三件會靜默壞掉的事：檔名進得去也讀得回來（不然版本清單會全部
 * 掉成 mtime 排序）、Lite 的節數真的少於 Full（不然降級等於沒發生）、
 * 以及渲染只吃傳進來的 docs（不然「核准版」會混進核准後才打的字）。
 */
import { describe, expect, test } from "bun:test";
import {
  lastApprovedFile,
  parsePrdVersionName,
  prdVersionFileName,
  renderPrdMarkdown,
  sortPrdFileVersions,
} from "../src/lib/prd-file";
import { SEED_SECTIONS } from "../src/data/seed";
import { VIBE_SECTIONS } from "../src/lib/prd-triage";
import type { PrdVersion, Project, Section } from "../src/data/types";

const AT = new Date("2026-09-01T14:20:00");

function version(kind: PrdVersion["kind"], at = AT): PrdVersion {
  return {
    id: `${kind}-1`,
    kind,
    at: at.toISOString(),
    byId: "u1",
    byName: "林可晴",
    message: "復原碼由 8 組改為 10 組",
    docs: { summary: { what: "雙重驗證", who: "企業客戶", why: "" } },
  };
}

const project = { id: "p1", title: "2FA", status: "review" } as Project;

describe("檔名", () => {
  test("寫出去讀得回來（來回不掉資訊）", () => {
    for (const kind of ["commit", "merge"] as const) {
      const name = prdVersionFileName({ kind }, AT);
      const back = parsePrdVersionName(name);
      expect(back?.kind, name).toBe(kind);
      expect(back?.at.getTime(), name).toBe(AT.getTime());
    }
  });

  test("認不得的檔名回 null，不拋錯 —— 使用者自己丟進來的檔不該讓畫面壞掉", () => {
    for (const bad of ["README.md", "PRD.md", "PRD-2026-09-01-commit.md", "PRD-20260901-1420-approved.md"]) {
      expect(parsePrdVersionName(bad), bad).toBeNull();
    }
  });
});

describe("sortPrdFileVersions", () => {
  test("新到舊，且時間優先讀檔名而不是 mtime", () => {
    // mtime 故意跟檔名相反：檔案被複製過，mtime 全變成「現在」
    const list = sortPrdFileVersions([
      { name: "PRD-20260101-0900-commit.md", mtimeMs: 9_000_000_000_000, bytes: 10 },
      { name: "PRD-20260901-1420-merge.md", mtimeMs: 1_000, bytes: 20 },
    ]);
    expect(list.map((v) => v.name)).toEqual([
      "PRD-20260901-1420-merge.md",
      "PRD-20260101-0900-commit.md",
    ]);
  });

  test("認不得的檔名退回 mtime，仍然排得進去", () => {
    const list = sortPrdFileVersions([{ name: "亂丟的.md", mtimeMs: 5_000, bytes: 1 }]);
    expect(list[0]!.kind).toBeNull();
    expect(list[0]!.at.getTime()).toBe(5_000);
  });
});

describe("lastApprovedFile", () => {
  test("只認 merge —— 沒核准過就是 null，不拿最新的送審版充數", () => {
    const only = sortPrdFileVersions([
      { name: "PRD-20260901-1420-commit.md", mtimeMs: 1, bytes: 1 },
    ]);
    expect(lastApprovedFile(only)).toBeNull();
  });

  test("有 merge 就回最新的那一份 merge", () => {
    const list = sortPrdFileVersions([
      { name: "PRD-20260101-0900-merge.md", mtimeMs: 1, bytes: 1 },
      { name: "PRD-20260901-1420-merge.md", mtimeMs: 2, bytes: 1 },
      { name: "PRD-20260902-0900-commit.md", mtimeMs: 3, bytes: 1 },
    ]);
    expect(lastApprovedFile(list)?.name).toBe("PRD-20260901-1420-merge.md");
  });
});

describe("renderPrdMarkdown", () => {
  const sections = SEED_SECTIONS.slice(0, 3) as Section[];

  test("只吃傳進來的 docs —— 版本裡沒有的內容不會出現", () => {
    const md = renderPrdMarkdown({ project, sections, docs: version("merge").docs, version: version("merge") });
    expect(md).toContain("雙重驗證");
    expect(md).toContain("復原碼由 8 組改為 10 組");
  });

  test("每一節都寫得出來，空的也寫一行 —— 整節消失會讓人分不出「沒寫」與「不在範圍裡」", () => {
    const md = renderPrdMarkdown({ project, sections, docs: {}, version: version("commit") });
    for (const s of sections) expect(md, s.id).toContain(`## ${s.n} ${s.title}`);
    expect(md.match(/（本章尚無內容）/g)?.length).toBe(sections.length);
  });

  test("抬頭講得出種類與節數 —— 一份被貼進 issue 的 markdown 只剩內容", () => {
    const md = renderPrdMarkdown({ project, sections, docs: {}, version: version("merge") });
    expect(md).toContain("核准");
    expect(md).toContain(`Full（${sections.length} 節）`);
  });

  test("Lite 專案的抬頭要說 Lite", () => {
    const md = renderPrdMarkdown({
      project: { ...project, route: "lite" },
      sections,
      docs: {},
      version: version("commit"),
    });
    expect(md).toContain("Lite（");
  });

  // 釘住 138 行那個坑：路線標籤原本是寫死的 lite/full 三元，vibe 會被
  // 誤標成「Full」而且看起來完全正常。這裡連同「只出三節」一起鎖。
  test("vibe 專案的抬頭說「試作（3 節）」，且只出試作的三節", () => {
    const vibeSections = SEED_SECTIONS.filter((s) =>
      (VIBE_SECTIONS as readonly string[]).includes(s.id),
    ) as Section[];
    expect(vibeSections.length).toBe(VIBE_SECTIONS.length); // 濾出來的真的是三節
    const md = renderPrdMarkdown({
      project: { ...project, route: "vibe" },
      sections: vibeSections,
      docs: version("merge").docs,
      version: version("merge"),
    });
    expect(md).toContain(`試作（${VIBE_SECTIONS.length} 節）`);
    expect(md).not.toContain("Full（");
    expect(md).not.toContain("Lite（");
    // 章節標題剛好是那三節 —— 不在範圍裡的一節都不出現
    const heads = md.match(/^## /gm) ?? [];
    expect(heads.length).toBe(VIBE_SECTIONS.length);
  });
});
