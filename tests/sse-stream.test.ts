import { describe, expect, test } from "bun:test";
import { drainSseLines } from "../src/lib/sse";

/**
 * SSE 切行是串流最容易隨機壞掉的一塊：chunk 邊界不保證落在換行上。
 * 錯了的症狀是「長回應偶爾噴 parse 錯誤」—— 難重現、難歸因。
 */
describe("drainSseLines", () => {
  test("完整的一行解析成事件", () => {
    const { events, rest } = drainSseLines('data: {"a":1}\n');
    expect(events).toEqual([{ a: 1 }]);
    expect(rest).toBe("");
  });

  test("半行留在緩衝區，不會被當成壞 JSON 丟掉", () => {
    const { events, rest } = drainSseLines('data: {"a":1}\ndata: {"b":');
    expect(events).toEqual([{ a: 1 }]);
    expect(rest).toBe('data: {"b":');
  });

  test("被切成兩半的物件，接上後仍解析得出來", () => {
    const first = drainSseLines('data: {"text":"前半');
    expect(first.events).toEqual([]);
    const second = drainSseLines(first.rest + '後半"}\n');
    expect(second.events).toEqual([{ text: "前半後半" }]);
  });

  test("[DONE] 哨符不當成事件", () => {
    expect(drainSseLines("data: [DONE]\n").events).toEqual([]);
  });

  test("註解行與空行略過", () => {
    const { events } = drainSseLines(': ping\n\ndata: {"a":1}\n');
    expect(events).toEqual([{ a: 1 }]);
  });

  test("event: 名稱這類非 JSON 行不會拋錯", () => {
    const { events } = drainSseLines('event: content_block_delta\ndata: {"a":1}\n');
    expect(events).toEqual([{ a: 1 }]);
  });

  test("一次多個事件依序回傳", () => {
    const { events } = drainSseLines('data: {"i":1}\ndata: {"i":2}\ndata: {"i":3}\n');
    expect(events).toEqual([{ i: 1 }, { i: 2 }, { i: 3 }]);
  });

  test("沒有 data: 前綴的裸 JSON 也接受（部分端點如此）", () => {
    expect(drainSseLines('{"a":1}\n').events).toEqual([{ a: 1 }]);
  });
});
