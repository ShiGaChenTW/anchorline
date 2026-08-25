/**
 * 五類 PRD 的簽核骨架 × 領域包疊加。
 *
 * 這支測的核心不是「合併出幾關」，而是三條會靜默壞掉的規則：
 * 同名關卡不重複、`order` 重新編號連續、「我核准」永遠殿後。
 * 三條都是「錯了也不會報錯，只是關卡跑到奇怪的位置」那一種。
 */
import { describe, expect, test } from "bun:test";
import { HUMAN_APPROVAL_STAGE_NAME, SEED_WORKFLOW_SKELETONS } from "../src/data/seed";
import { FINANCIAL_COMPLIANCE_STAGE_NAME, resolveWorkflow } from "../src/lib/workflow-resolve";
import type { FullCat, WorkflowStageDef } from "../src/data/types";

const ALL_CATS: FullCat[] = ["lean", "narrative", "enterprise", "agile", "technical"];

/** 金融四包在自己的 frontmatter 裡宣告的那一關（形狀與 domains/*.md 一致） */
function complianceStage(): WorkflowStageDef {
  return {
    id: "ws-fin-compliance",
    order: 1,
    name: FINANCIAL_COMPLIANCE_STAGE_NAME,
    defaultAssigneeId: null,
    required: true,
    mode: "sequential",
    kind: "review",
    defaultActor: "agent",
  };
}

function names(stages: WorkflowStageDef[]): string[] {
  return stages.map((s) => s.name);
}

describe("resolveWorkflow — 五類骨架", () => {
  test("每一類都解析得出關卡，而且最後一關是「我核准」", () => {
    for (const cat of ALL_CATS) {
      const out = resolveWorkflow(cat);
      expect(out.length).toBeGreaterThan(0);
      expect(out.at(-1)!.name).toBe(HUMAN_APPROVAL_STAGE_NAME);
      // 「我核准」永遠是人：這一關被指派給 agent 就等於沒有人在把關
      expect(out.at(-1)!.defaultActor).toBe("human");
    }
  });

  test("五類各自的關卡數與規格表一致", () => {
    expect(resolveWorkflow("lean")).toHaveLength(2);
    expect(resolveWorkflow("narrative")).toHaveLength(3);
    expect(resolveWorkflow("enterprise")).toHaveLength(5);
    expect(resolveWorkflow("agile")).toHaveLength(2);
    expect(resolveWorkflow("technical")).toHaveLength(3);
  });

  test("order 從 1 起連續編號", () => {
    for (const cat of ALL_CATS) {
      const out = resolveWorkflow(cat);
      expect(out.map((s) => s.order)).toEqual(out.map((_, i) => i + 1));
    }
  });

  test("enterprise 的「文件補完」是唯一的 edit 關卡，而且指得出落地欄位", () => {
    const fill = resolveWorkflow("enterprise").find((s) => s.kind === "edit");
    expect(fill?.name).toBe("文件補完");
    expect(fill?.editTarget).toEqual({ sectionId: "open", fieldKey: "oq" });
    // 其餘四類全是 review —— edit 會動到 PRD 內文，不該悄悄多出來
    for (const cat of ALL_CATS.filter((c) => c !== "enterprise")) {
      expect(resolveWorkflow(cat).every((s) => s.kind === "review")).toBe(true);
    }
  });

  test("非必簽關卡照規格表保留 required:false —— 那個旗標決定擋不擋結案", () => {
    const optional = (cat: FullCat) =>
      resolveWorkflow(cat).filter((s) => !s.required).map((s) => s.name);
    expect(optional("narrative")).toEqual(["FAQ 完整度"]);
    expect(optional("technical")).toEqual(["規格一致性"]);
    expect(optional("enterprise")).toEqual(["文件補完"]);
    expect(optional("lean")).toEqual([]);
    expect(optional("agile")).toEqual([]);
  });

  test("回傳是新物件 —— 改了結果不會汙染骨架常數", () => {
    const a = resolveWorkflow("lean");
    a[0]!.name = "被改壞的名字";
    expect(SEED_WORKFLOW_SKELETONS.lean[0]!.name).toBe("AI 結構審查");
    expect(resolveWorkflow("lean")[0]!.name).toBe("AI 結構審查");
  });

  test("認不得的分類退回 lean —— 章節範本的 cat 也會走到這裡", () => {
    expect(names(resolveWorkflow("core" as FullCat))).toEqual(names(resolveWorkflow("lean")));
    expect(names(resolveWorkflow(null))).toEqual(names(resolveWorkflow("lean")));
    expect(names(resolveWorkflow(undefined))).toEqual(names(resolveWorkflow("lean")));
  });
});

describe("resolveWorkflow — 領域包疊加", () => {
  test("金融關卡插在「我核准」之前，不是接在最後面", () => {
    for (const cat of ALL_CATS) {
      const out = resolveWorkflow(cat, [complianceStage()]);
      const list = names(out);
      expect(list).toContain(FINANCIAL_COMPLIANCE_STAGE_NAME);
      expect(list.at(-1)).toBe(HUMAN_APPROVAL_STAGE_NAME);
      expect(list.indexOf(FINANCIAL_COMPLIANCE_STAGE_NAME)).toBe(list.length - 2);
      expect(out).toHaveLength(resolveWorkflow(cat).length + 1);
      expect(out.map((s) => s.order)).toEqual(out.map((_, i) => i + 1));
    }
  });

  test("generic（沒有 stages）不追加任何關卡", () => {
    for (const cat of ALL_CATS) {
      expect(names(resolveWorkflow(cat, []))).toEqual(names(resolveWorkflow(cat)));
      expect(names(resolveWorkflow(cat, undefined))).toEqual(names(resolveWorkflow(cat)));
    }
  });

  test("同名關卡以骨架為準 —— 領域包蓋不掉骨架的設定", () => {
    const clash: WorkflowStageDef = {
      ...complianceStage(),
      id: "ws-pack-clash",
      name: "結構完整度",
      required: false,
      kind: "edit",
    };
    const out = resolveWorkflow("enterprise", [clash]);
    expect(out).toHaveLength(5);
    expect(out.filter((s) => s.name === "結構完整度")).toHaveLength(1);
    const kept = out.find((s) => s.name === "結構完整度")!;
    expect(kept.id).toBe("ws-ent-structure");
    expect(kept.required).toBe(true);
    expect(kept.kind).toBe("review");
  });

  test("領域包自己重複宣告同一關也只留一份", () => {
    const out = resolveWorkflow("lean", [complianceStage(), { ...complianceStage(), id: "ws-dup" }]);
    expect(out.filter((s) => s.name === FINANCIAL_COMPLIANCE_STAGE_NAME)).toHaveLength(1);
    expect(out).toHaveLength(3);
  });

  test("領域包自帶「我核准」不會讓最後多出第二關", () => {
    const out = resolveWorkflow("lean", [
      { ...complianceStage(), id: "ws-pack-approve", name: HUMAN_APPROVAL_STAGE_NAME, defaultActor: "agent" },
    ]);
    expect(out.filter((s) => s.name === HUMAN_APPROVAL_STAGE_NAME)).toHaveLength(1);
    // 骨架為準：領域包想把這一關交給 agent 也不算數
    expect(out.at(-1)!.defaultActor).toBe("human");
  });

  test("領域包多關時彼此的相對順序照它自己的 order", () => {
    const extra: WorkflowStageDef[] = [
      { ...complianceStage(), id: "ws-b", name: "乙關", order: 2 },
      { ...complianceStage(), id: "ws-a", name: "甲關", order: 1 },
    ];
    const list = names(resolveWorkflow("lean", extra));
    expect(list).toEqual(["AI 結構審查", "甲關", "乙關", HUMAN_APPROVAL_STAGE_NAME]);
  });

  test("關卡 id 保持穩定 —— 跨輪串接簽核紀錄靠它", () => {
    const a = resolveWorkflow("enterprise", [complianceStage()]);
    const b = resolveWorkflow("enterprise", [complianceStage()]);
    expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
    expect(new Set(a.map((s) => s.id)).size).toBe(a.length);
  });
});
