import { expect, test } from "bun:test";
import { getWhatsNewToastMessage } from "../src/lib/release-notes";

test("calls out the latest v1.5 polish in the what's-new toast", () => {
  expect(getWhatsNewToastMessage("1.5.16")).toBe(
    "v1.5.16: Reading controls, prose fonts, theme polish, and hidden-toolbar fixes are here",
  );
});

test("falls back to a generic update message for other versions", () => {
  expect(getWhatsNewToastMessage("2.0.0")).toBe("updated to v2.0.0");
});

test("calls out the v1.6 workflow release in the what's-new toast", () => {
  expect(getWhatsNewToastMessage("1.6.0")).toBe(
    "v1.6.0: Separate preview windows, markdown insertions, and Traditional Chinese localization are here",
  );
});
