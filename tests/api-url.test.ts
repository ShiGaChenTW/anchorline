/**
 * 供應商端點的 URL 組法。
 *
 * 起因是一份實際的錯誤回報：偏好設定裡的 API 端點填成
 * `https://api.anthropic.com/v1/`（結尾有斜線），舊的組法會產生
 * `https://api.anthropic.com/v1/v1/messages`。使用者只會看到「連線失敗」，
 * 完全看不出是自己多打了一個斜線。
 */
import { describe, expect, test } from "bun:test";
import { anthropicMessagesUrl, anthropicModelsUrl, geminiBase, trimBase } from "../src/lib/api-url";

describe("anthropicMessagesUrl", () => {
  test("只填主機 → 補 /v1/messages", () => {
    expect(anthropicMessagesUrl("https://api.anthropic.com")).toBe("https://api.anthropic.com/v1/messages");
  });

  test("留白 → 用預設主機", () => {
    expect(anthropicMessagesUrl("")).toBe("https://api.anthropic.com/v1/messages");
    expect(anthropicMessagesUrl("   ")).toBe("https://api.anthropic.com/v1/messages");
  });

  test("填到 /v1（結尾有無斜線都一樣）→ 不可重複 /v1", () => {
    for (const ep of ["https://api.anthropic.com/v1", "https://api.anthropic.com/v1/", "https://api.anthropic.com/v1///"]) {
      expect(anthropicMessagesUrl(ep), ep).toBe("https://api.anthropic.com/v1/messages");
    }
  });

  test("已經是完整 messages 端點 → 原樣使用（自架 proxy）", () => {
    expect(anthropicMessagesUrl("https://proxy.internal/anthropic/v1/messages")).toBe(
      "https://proxy.internal/anthropic/v1/messages",
    );
  });

  test("結尾斜線的主機也對", () => {
    expect(anthropicMessagesUrl("https://api.anthropic.com/")).toBe("https://api.anthropic.com/v1/messages");
  });
});

describe("anthropicModelsUrl", () => {
  test("同樣不可重複 /v1", () => {
    expect(anthropicModelsUrl("https://api.anthropic.com/v1/")).toBe("https://api.anthropic.com/v1/models");
    expect(anthropicModelsUrl("https://api.anthropic.com")).toBe("https://api.anthropic.com/v1/models");
  });
});

describe("geminiBase", () => {
  test("只填主機 → 補 /v1beta", () => {
    expect(geminiBase("https://generativelanguage.googleapis.com")).toBe(
      "https://generativelanguage.googleapis.com/v1beta",
    );
  });

  test("已經填到版本段 → 不重複補", () => {
    for (const ep of [
      "https://generativelanguage.googleapis.com/v1beta",
      "https://generativelanguage.googleapis.com/v1beta/",
      "https://generativelanguage.googleapis.com/v1",
    ]) {
      expect(geminiBase(ep), ep).toBe(ep.replace(/\/+$/, ""));
    }
  });
});

describe("trimBase", () => {
  test("去掉結尾斜線，空值走 fallback", () => {
    expect(trimBase("https://x/", "https://fallback")).toBe("https://x");
    expect(trimBase("", "https://fallback")).toBe("https://fallback");
  });
});
