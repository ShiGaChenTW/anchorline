import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearAllNoteDrafts,
  reconcileNoteDraft,
  setNoteDraft,
} from "../src/lib/uat-note-draft";

const P = "/proj/plans/uat-x.md";

beforeEach(() => clearAllNoteDrafts());

describe("uat-note-draft", () => {
  test("沒有草稿 → reconcile 回 undefined（textarea 維持磁碟值）", () => {
    expect(reconcileNoteDraft(P, "AAAA", "磁碟上的說明")).toBeUndefined();
  });

  test("F1' 主路徑：打字 → 別題寫檔觸發重繪 → 草稿還在", () => {
    setNoteDraft(P, "AAAA", "打到一半的原因");
    // 磁碟還是舊值（blur 被 mousedown guard 擋掉，沒寫回）
    expect(reconcileNoteDraft(P, "AAAA", "")).toBe("打到一半的原因");
    // 連續重繪（1 秒輪詢）也不會弄丟
    expect(reconcileNoteDraft(P, "AAAA", "")).toBe("打到一半的原因");
  });

  test("磁碟追上草稿 → 自清，之後不再干預", () => {
    setNoteDraft(P, "AAAA", "最終說明");
    expect(reconcileNoteDraft(P, "AAAA", "最終說明")).toBeUndefined();
    // 自清後：使用者在別處把說明改掉，草稿層不得吐回陳舊值
    expect(reconcileNoteDraft(P, "AAAA", "別人改的新說明")).toBeUndefined();
  });

  test("草稿以最後一次輸入為準", () => {
    setNoteDraft(P, "AAAA", "第一版");
    setNoteDraft(P, "AAAA", "第二版");
    expect(reconcileNoteDraft(P, "AAAA", "")).toBe("第二版");
  });

  test("清空成空字串也是草稿（使用者刪光 ≠ 沒草稿）", () => {
    setNoteDraft(P, "AAAA", "");
    // 磁碟還有舊字 → 空字串草稿要保住（使用者剛刪光還沒存）
    expect(reconcileNoteDraft(P, "AAAA", "磁碟舊字")).toBe("");
    // 磁碟也清成空 → 收斂自清
    expect(reconcileNoteDraft(P, "AAAA", "")).toBeUndefined();
  });

  test("不同報告同錨點不互相污染", () => {
    setNoteDraft(P, "AAAA", "報告一的草稿");
    expect(reconcileNoteDraft("/proj2/plans/uat-y.md", "AAAA", "")).toBeUndefined();
    expect(reconcileNoteDraft(P, "AAAA", "")).toBe("報告一的草稿");
  });

  test("同報告不同題各自獨立", () => {
    setNoteDraft(P, "AAAA", "A 的草稿");
    setNoteDraft(P, "BBBB", "B 的草稿");
    expect(reconcileNoteDraft(P, "AAAA", "A 的草稿")).toBeUndefined(); // A 收斂
    expect(reconcileNoteDraft(P, "BBBB", "")).toBe("B 的草稿"); // B 不受影響
  });
});
