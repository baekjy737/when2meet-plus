import assert from "node:assert/strict";
import { test } from "node:test";
import { bestBlocks, slotStats } from "./analysis";
import { exportCsv } from "./export";
import { allSlots } from "./slots";
import type { PublicEvent } from "./types";

const ev: PublicEvent = {
  id: "e1", name: "t", dates: ["2026-10-01", "2026-10-02"], startMin: 9 * 60, endMin: 11 * 60,
  slotMinutes: 30, timezone: "Asia/Seoul", createdAt: "",
};
const people = [
  { id: "a", name: "A", slots: ["2026-10-01T09:00", "2026-10-01T09:30", "2026-10-01T10:00"] },
  { id: "b", name: "B", slots: ["2026-10-01T09:30", "2026-10-01T10:00", "2026-10-02T10:30"] },
  { id: "c", name: "C", slots: ["2026-10-01T10:00", "2026-10-01T10:30", "2026-10-02T10:30"] },
];

test("allSlots covers every date x row", () => {
  assert.equal(allSlots(ev).length, 8);
  assert.equal(allSlots(ev)[0], "2026-10-01T09:00");
});

test("slotStats counts availability", () => {
  const s = slotStats(ev, people).find((x) => x.slot === "2026-10-01T10:00")!;
  assert.deepEqual(s.available, ["A", "B", "C"]);
  assert.equal(s.end, "10:30");
});

test("bestBlocks ranks by attendees for the full duration", () => {
  const [top] = bestBlocks(ev, people, { durationMin: 60 });
  assert.deepEqual([top.date, top.start, top.end, top.available], ["2026-10-01", "09:30", "10:30", ["A", "B"]]);
});

test("bestBlocks never spans two dates", () => {
  const blocks = bestBlocks(ev, people, { durationMin: 60 });
  assert.ok(blocks.every((b) => !(b.date === "2026-10-01" && b.start === "10:30")));
});

test("bestBlocks respects required people and minPeople", () => {
  const r = bestBlocks(ev, people, { durationMin: 30, required: ["C"], minPeople: 2 });
  assert.deepEqual(r.map((b) => b.date + " " + b.start), ["2026-10-01 10:00", "2026-10-02 10:30"]);
});

test("csv escapes and has BOM", () => {
  const csv = exportCsv(ev, [{ id: "x", name: 'Kim, "J"', slots: [] }]);
  assert.ok(csv.startsWith("﻿date,"));
  assert.ok(csv.includes('"Kim, ""J"""'));
});
