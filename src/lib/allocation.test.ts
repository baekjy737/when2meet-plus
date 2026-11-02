import assert from "node:assert/strict";
import { test } from "node:test";
import { allocateTime, type AllocationResult } from "./allocation";
import { allSlots, dateRange, slotId } from "./slots";
import type { PublicEvent, PublicParticipant } from "./types";

const event = (changes: Partial<PublicEvent> = {}): PublicEvent => ({
  id: "tf", name: "TF", mode: "time", dates: ["2026-11-02"], startMin: 540, endMin: 780,
  slotMinutes: 30, timezone: "Asia/Seoul", createdAt: "", ...changes,
});
const available = (ev: PublicEvent, ids: string[]): PublicParticipant[] => ids.map((id) => ({ id, name: id, slots: allSlots(ev) }));
const minutes = (time: string) => time.split(":").map(Number).reduce((hour, minute) => hour * 60 + minute);

function assertValid(ev: PublicEvent, people: PublicParticipant[], result: AllocationResult, needed: number) {
  const actualCounts = new Map(people.map((person) => [person.id, 0]));
  const byId = new Map(people.map((person) => [person.id, new Set(person.slots)]));
  let previous: AllocationResult["blocks"][number] | undefined;
  for (const block of result.blocks) {
    assert.equal(new Set(block.assigned.map((person) => person.id)).size, block.assigned.length);
    assert.equal(block.assigned.length, Math.min(needed, block.eligible.length));
    assert.equal(block.missing, needed - block.assigned.length);
    assert.equal(minutes(block.end) - minutes(block.start), block.minutes);
    if (previous?.date === block.date) assert.ok(minutes(previous.end) <= minutes(block.start));
    previous = block;
    for (const person of block.assigned) {
      assert.ok(block.eligible.some((eligible) => eligible.id === person.id));
      for (let minute = minutes(block.start); minute < minutes(block.end); minute += ev.slotMinutes) {
        assert.ok(byId.get(person.id)?.has(slotId(block.date, minute)), `${person.id} unavailable at ${block.date} ${minute}`);
      }
      actualCounts.set(person.id, actualCounts.get(person.id)! + 1);
    }
  }
  for (const person of result.people) {
    assert.equal(person.count, actualCounts.get(person.id));
    assert.equal(person.minutes, result.blocks.filter((block) => block.assigned.some((assigned) => assigned.id === person.id)).reduce((sum, block) => sum + block.minutes, 0));
    assert.equal(person.eligibleBlocks, result.blocks.filter((block) => block.eligible.some((eligible) => eligible.id === person.id)).length);
  }
}

test("allocation rejects invalid durations, staffing and date-mode events", () => {
  for (const durationMin of [0, -30, 45, 300, NaN, Infinity, 30.5]) {
    assert.throws(() => allocateTime(event(), [], { durationMin, minPeople: 1 }), /배정 시간/);
  }
  for (const minPeople of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => allocateTime(event(), [], { durationMin: 60, minPeople }), /최소 인원/);
  }
  assert.throws(() => allocateTime(event({ mode: "date" }), [], { durationMin: 60, minPeople: 1 }), /시간 조율/);
  assert.throws(() => allocateTime(event({ slotMinutes: 0 }), [], { durationMin: 60, minPeople: 1 }), /시간 범위/);
});

test("allocation anchors each day, orders dates and exposes the shorter daily tail", () => {
  const ev = event({ dates: ["2026-11-04", "2026-11-02"], endMin: 750 });
  const people = available(ev, ["A", "B"]);
  const result = allocateTime(ev, people, { durationMin: 60, minPeople: 1 });
  assert.deepEqual(result.blocks.map((block) => [block.date, block.start, block.end]), [
    ["2026-11-02", "09:00", "10:00"], ["2026-11-02", "10:00", "11:00"], ["2026-11-02", "11:00", "12:00"],
    ["2026-11-04", "09:00", "10:00"], ["2026-11-04", "10:00", "11:00"], ["2026-11-04", "11:00", "12:00"],
  ]);
  assert.deepEqual(result.remainders, [
    { date: "2026-11-02", start: "12:00", end: "12:30", minutes: 30 },
    { date: "2026-11-04", start: "12:00", end: "12:30", minutes: 30 },
  ]);
  assertValid(ev, people, result, 1);
});

test("partial-block availability cannot fill a whole block; deficits stay visible", () => {
  const ev = event({ endMin: 660 });
  const people = [
    { id: "A", name: "A", slots: ["2026-11-02T09:00"] },
    { id: "B", name: "B", slots: ["2026-11-02T09:30"] },
    { id: "C", name: "C", slots: ["2026-11-02T09:00", "2026-11-02T09:30"] },
  ];
  const result = allocateTime(ev, people, { durationMin: 60, minPeople: 2 });
  assert.deepEqual(result.blocks.map((block) => [block.eligible.map((person) => person.id), block.missing]), [[["C"], 1], [[], 2]]);
  assert.deepEqual(result.people.map((person) => person.count), [0, 0, 1]);
  assertValid(ev, people, result, 2);
});

test("repeated staffing assigns exactly the requested headcount and spreads workload", () => {
  const ev = event({ endMin: 840 });
  const people = available(ev, ["A", "B", "C"]);
  const result = allocateTime(ev, people, { durationMin: 60, minPeople: 2 });
  assert.equal(result.blocks.length, 5);
  assert.deepEqual(result.people.map((person) => person.count).sort(), [3, 3, 4]);
  assert.equal(result.people.reduce((sum, person) => sum + person.minutes, 0), 600);
  assert.equal(result.balanceLimited, false);
  assertValid(ev, people, result, 2);
});

test("alternating reassignment fixes a fairness trap requiring two linked swaps", () => {
  // Scarcity-first gives [A=2,B=1,C=3,D=2]. C cannot give B a shift
  // directly: move C -> D at 12:00, then D -> B at 09:00 instead.
  const ev = event();
  const eligible = [["B", "D"], ["B"], ["C"], ["C"], ["A", "B", "D"], ["B", "D"], ["C", "D"], ["A", "B", "C"]];
  const people = ["A", "B", "C", "D"].map((id) => ({
    id, name: id, slots: eligible.flatMap((row, index) => row.includes(id) ? [slotId(ev.dates[0], ev.startMin + index * 30)] : []),
  }));
  const result = allocateTime(ev, people, { durationMin: 30, minPeople: 1 });
  assert.deepEqual(result.people.map((person) => person.count), [2, 2, 2, 2]);
  assert.equal(result.balanceLimited, false);
  assertValid(ev, people, result, 1);
});

test("availability constraints may force unequal counts without overstaffing", () => {
  const ev = event({ endMin: 660 });
  const people = available(ev, ["A"]);
  people.push({ id: "B", name: "B", slots: ["2026-11-02T10:30"] }, { id: "C", name: "C", slots: [] });
  const result = allocateTime(ev, people, { durationMin: 30, minPeople: 1 });
  assert.deepEqual(result.people.map((person) => person.count), [3, 1, 0]);
  assert.equal(result.balanceLimited, false);
  assertValid(ev, people, result, 1);
});

test("empty participant lists return unstaffed rows, not false full coverage", () => {
  const ev = event();
  const result = allocateTime(ev, [], { durationMin: 60, minPeople: 2 });
  assert.equal(result.blocks.length, 4);
  assert.ok(result.blocks.every((block) => block.missing === 2 && block.assigned.length === 0));
  assert.deepEqual(result.people, []);
  assert.equal(result.balanceLimited, false);
});

test("input order and duplicate display names cannot change participant identity or results", () => {
  const ev = event({ dates: ["2026-11-03", "2026-11-02"] });
  const people = available(ev, ["B", "A", "C"]).map((person) => ({ ...person, name: "같은 이름" }));
  const snapshot = JSON.stringify({ ev, people });
  const result = allocateTime(ev, people, { durationMin: 60, minPeople: 2 });
  const shuffled = allocateTime({ ...ev, dates: [...ev.dates].reverse() }, [...people].reverse().map((person) => ({ ...person, slots: [...person.slots].reverse() })), { durationMin: 60, minPeople: 2 });
  assert.deepEqual(result, shuffled);
  assert.equal(JSON.stringify({ ev, people }), snapshot);
  assert.deepEqual(result.people.map((person) => person.id), ["A", "B", "C"]);
  assertValid(ev, people, result, 2);
});

test("end-of-day blocks can end at 24:00 without crossing into the next date", () => {
  const ev = event({ dates: ["2026-11-02", "2026-11-03"], startMin: 1380, endMin: 1440 });
  const people = available(ev, ["A"]);
  const result = allocateTime(ev, people, { durationMin: 60, minPeople: 1 });
  assert.deepEqual(result.blocks.map((block) => [block.date, block.start, block.end]), [
    ["2026-11-02", "23:00", "24:00"], ["2026-11-03", "23:00", "24:00"],
  ]);
  assert.deepEqual(result.remainders, []);
  assertValid(ev, people, result, 1);
});

test("62 full days remain bounded and balanced at the smallest slot size", () => {
  const ev = event({ dates: dateRange("2026-01-01", "2026-03-03"), startMin: 0, endMin: 1440, slotMinutes: 15 });
  const people = available(ev, Array.from({ length: 12 }, (_, index) => `p${index}`));
  const result = allocateTime(ev, people, { durationMin: 15, minPeople: 3 });
  assert.equal(result.blocks.length, 62 * 96);
  assert.ok(result.people.every((person) => person.count === 1488 && person.eligibleBlocks === 5952));
  assert.ok(result.blocks.every((block) => block.assigned.length === 3 && block.missing === 0));
  assert.equal(result.balanceLimited, false);
});

test("balancing budget keeps a large constrained result valid and reports the limit", () => {
  const ev = event({ dates: dateRange("2026-11-01", "2026-11-10"), startMin: 0, endMin: 750, slotMinutes: 15 });
  const slots = allSlots(ev);
  const people = Array.from({ length: 100 }, (_, index) => ({ id: `p${index}`, name: `P${index}`, slots: slots.slice(0, -1) }));
  people.push({ id: "limited", name: "Limited", slots: slots.slice(-1) });
  const result = allocateTime(ev, people, { durationMin: 15, minPeople: 1 });
  assert.equal(result.balanceLimited, true);
  assert.ok(result.blocks.every((block) => block.assigned.length === 1 && block.missing === 0));
  assert.equal(result.people.find((person) => person.id === "limited")?.count, 1);
  assertValid(ev, people, result, 1);
});
