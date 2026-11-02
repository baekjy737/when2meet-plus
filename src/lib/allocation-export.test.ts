import assert from "node:assert/strict";
import { test } from "node:test";
import { exportAllocationCsv } from "./allocation-export";
import type { AllocationResult } from "./allocation";

test("allocation CSV preserves staffing deficits, backup names, and chronological remainders", () => {
  const result: AllocationResult = {
    blocks: [
      { id: "b2", date: "2026-11-03", start: "09:00", end: "10:00", minutes: 60, eligible: [{ id: "a", name: "가" }], assigned: [{ id: "a", name: "가" }], missing: 1 },
      { id: "b1", date: "2026-11-02", start: "09:00", end: "10:00", minutes: 60, eligible: [{ id: "a", name: "가" }, { id: "b", name: "나" }], assigned: [{ id: "b", name: "나" }], missing: 0 },
    ],
    people: [], balanceLimited: false,
    remainders: [{ date: "2026-11-02", start: "10:00", end: "10:30", minutes: 30 }],
  };
  const csv = exportAllocationCsv(result);
  const rows = csv.split("\r\n");
  assert.ok(rows[0].startsWith("\uFEFF날짜,시작,종료"));
  assert.equal(rows[1], "2026-11-02,09:00,10:00,배정 타임,60,1,1,0,나,가,");
  assert.equal(rows[2], "2026-11-02,10:00,10:30,미배정 잔여,30,,0,,,,타임 길이보다 짧은 구간");
  assert.equal(rows[3], "2026-11-03,09:00,10:00,배정 타임,60,2,1,1,가,,최소 인원 부족");
});

test("allocation CSV quotes free text and prevents participant formulas", () => {
  const people = [{ id: "a", name: '=HYPERLINK("example")' }, { id: "b", name: '김, "나"\n다' }];
  const result: AllocationResult = {
    blocks: [{ id: "b", date: "2026-11-02", start: "09:00", end: "10:00", minutes: 60, eligible: people, assigned: [people[0]], missing: 0 }],
    people: [], remainders: [], balanceLimited: false,
  };
  const csv = exportAllocationCsv(result);
  assert.ok(csv.includes('"\'=HYPERLINK(""example"")"'));
  assert.ok(csv.includes('"김, ""나""\n다"'));
  assert.ok(csv.endsWith("\r\n"));
});
