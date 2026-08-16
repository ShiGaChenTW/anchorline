import { describe, expect, test } from "bun:test";
import { trackingUrlFor } from "../src/lib/uat-handoff";

describe("UAT 著陸網址", () => {
  test("喚醒鏈停在 uat.html，不再進 Task Tracking", () => {
    expect(trackingUrlFor("/repo/plans/uat-checkout.md")).toBe(
      "uat.html?uat=%2Frepo%2Fplans%2Fuat-checkout.md",
    );
  });
});
