/**
 * iframe 裡的原生偵測。
 *
 * 背景：偏好設定是用 iframe 載入 `settings.html`（`settings-modal.ts`），
 * 而 Tauri 只把 `__TAURI_INTERNALS__` 注入頂層 frame。在此之前每個
 * `isNative()` 呼叫點都剛好只出現在頂層頁面，所以這個坑一直沒被踩到——
 * 直到領域包把「選擇資料夾」放進設定頁，按鈕就永遠是灰的。
 *
 * 這一組鎖住的是「iframe 借得到父層的通道」，以及「借不到時要誠實回 false」。
 */
import { describe, expect, test } from "bun:test";
import { adoptParentInternals } from "../src/lib/native";

const INTERNALS = { invoke: () => {} };

describe("adoptParentInternals", () => {
  test("iframe 沒有 internals 時，向父層借", () => {
    const parent: Record<string, unknown> = { __TAURI_INTERNALS__: INTERNALS };
    const w: Record<string, unknown> = { parent, top: parent };
    expect(adoptParentInternals(w)).toBe(true);
    expect(w.__TAURI_INTERNALS__).toBe(INTERNALS);
  });

  test("父層沒有就往 top 找（多層 iframe）", () => {
    const top: Record<string, unknown> = { __TAURI_INTERNALS__: INTERNALS };
    const parent: Record<string, unknown> = {};
    const w: Record<string, unknown> = { parent, top };
    expect(adoptParentInternals(w)).toBe(true);
    expect(w.__TAURI_INTERNALS__).toBe(INTERNALS);
  });

  test("自己已經有就不動它（頂層頁面走這條）", () => {
    const own = { invoke: () => {} };
    const w: Record<string, unknown> = { __TAURI_INTERNALS__: own, parent: { __TAURI_INTERNALS__: INTERNALS } };
    expect(adoptParentInternals(w)).toBe(false);
    expect(w.__TAURI_INTERNALS__).toBe(own);
  });

  test("頂層且不在 Tauri 裡 → 什麼都不做（parent === self）", () => {
    const w: Record<string, unknown> = {};
    w.parent = w;
    w.top = w;
    expect(adoptParentInternals(w)).toBe(false);
    expect("__TAURI_INTERNALS__" in w).toBe(false);
  });

  test("跨來源被擋時不拋錯，誠實回 false", () => {
    // 不同源的 frame 存取屬性會丟 SecurityError。那代表真的沒有原生通道，
    // 這時候維持「不是桌面版」才是對的——不要在這裡假裝有。
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("SecurityError: cross-origin");
        },
        has() {
          return false;
        },
      },
    );
    const w: Record<string, unknown> = { parent: hostile, top: hostile };
    expect(() => adoptParentInternals(w)).not.toThrow();
    expect(adoptParentInternals(w)).toBe(false);
    expect("__TAURI_INTERNALS__" in w).toBe(false);
  });

  test("父層存在但沒有 internals（瀏覽器裡的 iframe）→ false", () => {
    const w: Record<string, unknown> = { parent: {}, top: {} };
    expect(adoptParentInternals(w)).toBe(false);
    expect("__TAURI_INTERNALS__" in w).toBe(false);
  });
});
