
import { isNative, native } from "./native";
/**
 * 在編輯欄裡開一個磁碟上的檔（目前用於 OpenSpec 區塊）。
 *
 * 為什麼不叫外部程式：點一個 `proposal.md` 是為了「看一眼順手改一句」，
 * 跳出去開 VS Code 等於離開現在的情境，回來還要重新找到位置。
 *
 * 邊界：
 * - 只讀寫使用者自己點開的那一個既有檔，不建立新檔、不刪檔。
 *   守門在 Swift 端的 `isEditablePath`。
 * - **不自動存檔。** 這是使用者專案裡的真實檔案，不是 App 自己的資料；
 *   PRD 章節可以邊打邊存是因為那是 App 的東西，這裡不是。要按存檔。
 * - 有未存變更時切走會擋一次。
 */

export type FileDoc = {
  path: string;
  /** 磁碟上的原文，用來判斷有沒有改過 */
  original: string;
};

export function canEditFiles(): boolean {
  return isNative();
}

export async function readFile(path: string): Promise<string> {
  const r = await native.readFile(path);
  return r.text;
}

export async function writeFile(path: string, text: string): Promise<void> {
  await native.writeFile(path, text);
}

/** 顯示用的短路徑：`openspec/` 之後那一段就夠認人，前面全是重複的 */
export function shortPath(path: string): string {
  const m = path.match(/openspec\/(.*)$/i);
  if (m) return `openspec/${m[1]}`;
  const parts = path.split("/");
  return parts.slice(-3).join("/");
}
