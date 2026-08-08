import { describe, expect, test } from "bun:test";
import { migrateStorageKeys } from "../src/lib/storage-migrate";

/** 夠用的 Storage 替身：真的照 index 列舉，才測得到「邊列舉邊寫」的位移 bug。 */
function fakeStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  } as Storage;
}

describe("localStorage 前綴遷移 specforge: → anchorline:", () => {
  test("搬得過去，而且舊 key 留著（要能退版）", () => {
    const s = fakeStorage({ "specforge:theme": "kami", "specforge:state:v6:prod": "{}" });
    expect(migrateStorageKeys(s)).toBe(2);
    expect(s.getItem("anchorline:theme")).toBe("kami");
    expect(s.getItem("anchorline:state:v6:prod")).toBe("{}");
    expect(s.getItem("specforge:theme")).toBe("kami");
  });

  test("新 key 已有值就不覆蓋 —— 使用者改名後的設定優先", () => {
    const s = fakeStorage({ "specforge:theme": "kami", "anchorline:theme": "github" });
    migrateStorageKeys(s);
    expect(s.getItem("anchorline:theme")).toBe("github");
  });

  test("只跑一次，第二次是 no-op", () => {
    const s = fakeStorage({ "specforge:theme": "kami" });
    expect(migrateStorageKeys(s)).toBe(2 - 1);
    s.setItem("specforge:late", "x");
    expect(migrateStorageKeys(s)).toBe(0);
    expect(s.getItem("anchorline:late")).toBeNull();
  });

  test("不碰其他前綴的 key", () => {
    const s = fakeStorage({ other: "1", "specforgery:x": "2" });
    expect(migrateStorageKeys(s)).toBe(0);
    expect(s.getItem("anchorline:x")).toBeNull();
  });

  test("沒有舊資料時也不會炸", () => {
    expect(migrateStorageKeys(fakeStorage())).toBe(0);
  });
});
