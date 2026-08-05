import { expect, test } from "bun:test";
import { extensionFromMarkdownAssetSrc, markdownMediaAssetForExtension } from "../src/lib/media-assets";

test("detects markdown media assets by extension", () => {
  expect(markdownMediaAssetForExtension("mp4")).toEqual({ kind: "video", mime: "video/mp4" });
  expect(markdownMediaAssetForExtension("m4a")).toEqual({ kind: "audio", mime: "audio/mp4" });
  expect(markdownMediaAssetForExtension("png")).toEqual({ kind: "image", mime: "image/png" });
});

test("extracts asset extensions from markdown image sources", () => {
  expect(extensionFromMarkdownAssetSrc("./clips/demo.webm?cache=1#preview")).toBe("webm");
  expect(extensionFromMarkdownAssetSrc("notes/audio")).toBe("png");
});
