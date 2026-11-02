import test from "node:test";
import assert from "node:assert/strict";
import { mergeContinuousBlocks, type Block } from "./analysis";

function block(date: string, start: string, end: string, names = ["가", "나"]): Block {
  const minutes = (value: string) => { const [h, m] = value.split(":").map(Number); return h * 60 + m; };
  return { date, start, end, minutes: minutes(end) - minutes(start), available: names, unavailable: [] };
}

test("continuous view merges overlaps and touching spans before ranking without mutating candidates", () => {
  const input = [block("2030-01-01", "10:00", "11:00"), block("2030-01-01", "09:00", "10:00", ["나", "가"]), block("2030-01-01", "09:30", "10:30")];
  const original = structuredClone(input);
  const output = mergeContinuousBlocks(input);
  assert.equal(output.length, 1);
  assert.equal(output[0].start, "09:00"); assert.equal(output[0].end, "11:00"); assert.equal(output[0].minutes, 120);
  assert.deepEqual(input, original);
});

test("continuous view preserves gaps, attendee changes and date boundaries, including midnight", () => {
  const output = mergeContinuousBlocks([
    block("2030-01-01", "22:00", "23:00"), block("2030-01-01", "23:00", "24:00"),
    block("2030-01-02", "00:00", "01:00"), block("2030-01-01", "10:00", "11:00"),
    block("2030-01-01", "11:00", "12:00", ["가"]),
  ]);
  assert.equal(output.length, 4);
  assert.equal(output.find((b) => b.start === "22:00")?.minutes, 120);
  assert.equal(output.at(-1)?.available.length, 1);
});

test("date candidates remain independent", () => {
  const input: Block[] = [{ date: "2030-01-01", start: "", end: "", minutes: 0, available: ["가"], unavailable: [] }];
  assert.deepEqual(mergeContinuousBlocks(input), input);
});
