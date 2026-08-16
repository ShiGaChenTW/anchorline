import { describe, expect, test } from "bun:test";
import {
  extraPrefix,
  formatEvidenceLine,
  formatExtrasSection,
  isEvidenceName,
  isExtraSectionTitle,
  itemPrefix,
  nextEvidenceName,
  nextExtraNumber,
  parseEvidenceLine,
  parseExtraBody,
  reportAssetStem,
} from "../src/lib/uat-evidence";
import {
  parseUatReport,
  serializeUatReport,
  setEvidence,
  setExtras,
  setVerdict,
} from "../src/lib/uat-parser";

function mintFrom(ids: string[]): () => string {
  let i = 0;
  return () => ids[i++]!;
}

function sample() {
  return serializeUatReport(
    {
      title: "證物",
      items: [
        {
          title: "過濾列在上方",
          steps: ["開會議"],
          expected: "過濾列在紀錄上方",
        },
      ],
    },
    { now: "2026-08-17 00:00", mint: mintFrom(["AAAA1111"]) },
  );
}

describe("uat-evidence 命名", () => {
  test("題號取自標題 T 前綴，否則用序號", () => {
    expect(itemPrefix("T1 過濾列", 9)).toBe("T1");
    expect(itemPrefix("t12 其他", 1)).toBe("T12");
    expect(itemPrefix("沒有題號", 3)).toBe("T3");
  });

  test("流水號從既有檔名往下編，刪中間不重用除非真的沒了", () => {
    expect(nextEvidenceName("T1", [])).toBe("T1-01.png");
    expect(
      nextEvidenceName("T1", [{ name: "T1-01.png" }, { name: "T1-03.jpg" }]),
    ).toBe("T1-04.png");
    expect(nextEvidenceName("S2", [{ name: "S2-01.webp" }], "jpg")).toBe(
      "S2-02.jpg",
    );
  });

  test("補充編號穩定往上加", () => {
    expect(nextExtraNumber([])).toBe(1);
    expect(nextExtraNumber([{ n: 1 }, { n: 3 }])).toBe(4);
    expect(extraPrefix(2)).toBe("S2");
  });

  test("檔名與補充標題是封閉集合", () => {
    expect(isEvidenceName("T1-01.png")).toBe(true);
    expect(isEvidenceName("S12-03.WEBP")).toBe(true);
    expect(isEvidenceName("../T1-01.png")).toBe(false);
    expect(isEvidenceName("T1-1.png")).toBe(false);
    expect(isExtraSectionTitle("補充說明")).toBe(true);
    expect(isExtraSectionTitle("補充")).toBe(true);
    expect(isExtraSectionTitle("補充作業")).toBe(false);
  });

  test("相對路徑用報告檔名當 stem", () => {
    expect(reportAssetStem("/repo/plans/uat-council.md")).toBe("uat-council");
    expect(parseEvidenceLine("- ![T1-01](uat-assets/x/T1-01.png) 紅框")).toEqual({
      name: "T1-01.png",
      rel: "uat-assets/x/T1-01.png",
      caption: "紅框",
    });
    expect(formatEvidenceLine({
      name: "T1-01.png",
      rel: "uat-assets/x/T1-01.png",
      caption: "紅框",
    })).toBe("- ![T1-01](uat-assets/x/T1-01.png) 紅框");
  });
});

describe("UAT parser：附件與補充說明", () => {
  test("補充說明不是一題，不增加 unanchored、不計入進度", () => {
    const text = [
      sample().trimEnd(),
      "",
      "## 補充說明",
      "",
      "1. 側欄太窄會擋到過濾列",
      "   - ![S1-01](uat-assets/uat-證物/S1-01.png) iPhone SE",
      "2. 建議通過後捲到下一題",
      "",
    ].join("\n");
    const r = parseUatReport(text, "/w/plans/uat-證物.md");
    expect(r.items).toHaveLength(1);
    expect(r.unanchored).toBe(0);
    expect(r.extras).toHaveLength(2);
    expect(r.extras[0]).toMatchObject({
      n: 1,
      text: "側欄太窄會擋到過濾列",
    });
    expect(r.extras[0]!.evidence[0]).toMatchObject({
      name: "S1-01.png",
      caption: "iPhone SE",
    });
    expect(r.extras[1]!.text).toBe("建議通過後捲到下一題");
  });

  test("題目附件與說明分欄，setVerdict 不吃附件", () => {
    const ev = [
      {
        name: "T1-01.png",
        rel: "uat-assets/uat-證物/T1-01.png",
        caption: "實際位置",
      },
    ];
    const withEv = setEvidence(sample(), "AAAA1111", ev);
    expect(withEv.ok).toBe(true);
    if (!withEv.ok) return;
    const failed = setVerdict(withEv.text, "AAAA1111", "fail", "過濾列在下方", {
      now: "2026-08-17 01:00",
    });
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    const parsed = parseUatReport(failed.text);
    expect(parsed.items[0]).toMatchObject({
      verdict: "fail",
      note: "過濾列在下方",
    });
    expect(parsed.items[0]!.evidence).toEqual(ev);
  });

  test("setExtras 只動補充區，題目區段位元組不變", () => {
    const before = setVerdict(sample(), "AAAA1111", "fail", "先記下", {
      now: "2026-08-17 01:00",
    });
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const after = setExtras(
      before.text,
      [{ n: 1, text: "另外發現字太小", evidence: [] }],
      { now: "2026-08-17 01:05" },
    );
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const parsed = parseUatReport(after.text);
    expect(parsed.items[0]).toMatchObject({
      id: "AAAA1111",
      verdict: "fail",
      note: "先記下",
      evidence: [],
    });
    expect(parsed.extras[0]!.text).toBe("另外發現字太小");
    expect(after.text).toContain("**最後更新：** 2026-08-17 01:05");
    expect(after.text.indexOf("## T1")).toBeLessThan(after.text.indexOf("## 補充說明"));
  });

  test("清空補充會拿掉區段，不留空標題", () => {
    const added = setExtras(sample(), [
      { n: 1, text: "暫記", evidence: [] },
    ]);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const cleared = setExtras(added.text, []);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.text).not.toContain("## 補充說明");
    expect(parseUatReport(cleared.text).extras).toEqual([]);
  });

  test("formatExtrasSection 空陣列不產區塊", () => {
    expect(formatExtrasSection([])).toEqual([]);
    expect(parseExtraBody(["1. 只有文字"]).map((e) => e.text)).toEqual([
      "只有文字",
    ]);
  });
});
