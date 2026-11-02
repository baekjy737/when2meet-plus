import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { bestBlocks, slotStats } from "./analysis";
import { exportCsv, exportJson, exportXlsx } from "./export";
import { allSlots, dateRange, isValidDate } from "./slots";
import { SqliteStore } from "./store/sqlite";
import type { EventRecord, PublicEvent } from "./types";

const ev: PublicEvent = {
  id: "dates", name: "날짜 조율", mode: "date", dates: ["2026-11-02", "2026-11-03", "2026-11-04"],
  startMin: 0, endMin: 1440, slotMinutes: 1440, timezone: "Asia/Seoul", createdAt: "",
};
const people = [
  { id: "a", name: "A", slots: ["2026-11-02", "2026-11-03"] },
  { id: "b", name: "B", slots: ["2026-11-03", "2026-11-04"] },
  { id: "c", name: "C", slots: ["2026-11-04"] },
];

test("dateRange validates calendar dates and counts both endpoints across boundaries", () => {
  assert.equal(isValidDate("2024-02-29"), true);
  for (const invalid of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-1-02", "no date"]) {
    assert.equal(isValidDate(invalid), false, invalid);
  }
  assert.deepEqual(dateRange("2024-02-28", "2024-03-01"), ["2024-02-28", "2024-02-29", "2024-03-01"]);
  assert.deepEqual(dateRange("2026-12-31", "2027-01-01"), ["2026-12-31", "2027-01-01"]);
  assert.deepEqual(dateRange("2026-03-07", "2026-03-10"), ["2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"]);
  assert.deepEqual(dateRange("2026-11-02", "2026-11-02"), ["2026-11-02"]);
  assert.equal(dateRange("2026-01-01", "2026-03-03").length, 62);
  assert.deepEqual(dateRange("2026-01-01", "2026-03-04"), []);
  assert.deepEqual(dateRange("2026-11-03", "2026-11-02"), []);
  assert.deepEqual(dateRange("2026-02-30", "2026-03-02"), []);
});

test("date availability has one slot per date and no artificial times", () => {
  assert.deepEqual(allSlots(ev), ev.dates);
  assert.deepEqual(slotStats(ev, people)[1], {
    slot: "2026-11-03", date: "2026-11-03", start: "", end: "", available: ["A", "B"], unavailable: ["C"],
  });
});

test("date ranking counts each day independently, breaks ties by date and ignores duration", () => {
  const blocks = bestBlocks(ev, people, { durationMin: 2880 });
  assert.deepEqual(blocks.map((block) => block.date), ["2026-11-03", "2026-11-04", "2026-11-02"]);
  assert.ok(blocks.every((block) => block.minutes === 0 && block.start === "" && block.end === ""));
  assert.deepEqual(bestBlocks(ev, people, { minPeople: 2, required: ["C"] }).map((block) => block.date), ["2026-11-04"]);
  assert.equal(bestBlocks(ev, people, { limit: 1 }).length, 1);
  assert.deepEqual(bestBlocks(ev, [], {}), []);
});

test("date JSON and CSV exports retain date-only values and omit time columns", () => {
  const json = exportJson(ev, people, { durationMin: 2880 });
  assert.equal(json.event.mode, "date");
  assert.ok(!("start" in json.event) && !("slotMinutes" in json.event));
  assert.deepEqual(json.bestTimes[0], { date: "2026-11-03", available: ["A", "B"], unavailable: ["C"] });
  assert.ok(json.slots.every((slot) => !("start" in slot) && !("end" in slot)));
  const csv = exportCsv(ev, people);
  assert.equal(csv.split("\r\n")[0], "\uFEFFdate,count,total,available,unavailable");
  assert.ok(csv.includes("2026-11-03,2,3,A; B,C"));
  assert.ok(!csv.includes("00:00") && !csv.includes("24:00"));
});

test("date Excel uses date sheets and preserves date-only participant matrix", async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Uint8Array.from(await exportXlsx(ev, people, {})).buffer);
  assert.deepEqual(wb.worksheets.map((sheet) => sheet.name), ["최적 날짜", "날짜별", "매트릭스"]);
  assert.deepEqual(wb.worksheets[0].getRow(1).values, [, "순위", "날짜", "가능 인원", "전체", "가능", "불가"]);
  assert.deepEqual(wb.worksheets[1].getRow(1).values, [, "날짜", "가능 인원", "가능", "불가"]);
  assert.deepEqual(wb.worksheets[2].getRow(1).values, [, "이름", ...ev.dates]);
  assert.deepEqual(wb.worksheets[2].getRow(2).values, [, "A", 1, 1, 0]);
});

test("time exports retain existing duration, columns and sheet names", async () => {
  const timeEvent: PublicEvent = { ...ev, mode: "time", dates: ["2026-11-02"], startMin: 540, endMin: 600, slotMinutes: 30 };
  const timePeople = [{ id: "a", name: "A", slots: allSlots(timeEvent) }];
  const json = exportJson(timeEvent, timePeople, { durationMin: 60 });
  assert.equal(json.event.start, 540);
  assert.deepEqual(json.bestTimes[0], { date: "2026-11-02", start: "09:00", end: "10:00", minutes: 60, available: ["A"], unavailable: [] });
  assert.equal(exportCsv(timeEvent, timePeople).split("\r\n")[0], "\uFEFFdate,start,end,count,total,available,unavailable");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Uint8Array.from(await exportXlsx(timeEvent, timePeople, {})).buffer);
  assert.deepEqual(wb.worksheets.map((sheet) => sheet.name), ["최적 시간", "시간대별", "매트릭스"]);
  assert.equal(wb.worksheets[0].getCell("C1").value, "시작");
  assert.equal(wb.worksheets[0].getCell("D1").value, "종료");
});

test("SQLite migrates legacy events without changing existing responses and reopens safely", async () => {
  const dir = mkdtempSync(join(tmpdir(), "when2meet-date-store-"));
  const path = join(dir, "test.db");
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE events (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, dates TEXT NOT NULL,
      start_min INTEGER NOT NULL, end_min INTEGER NOT NULL, slot_minutes INTEGER NOT NULL,
      timezone TEXT NOT NULL, admin_key_hash TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE participants (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name TEXT NOT NULL, password_hash TEXT, session_hash TEXT NOT NULL,
      slots TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(event_id, name)
    );
  `);
  legacy.prepare("INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("legacy", "Existing meeting", '["2026-11-02"]', 540, 600, 30, "Asia/Seoul", "admin-hash", "created");
  legacy.prepare("INSERT INTO participants VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("p", "legacy", "A", null, "session-hash", '["2026-11-02T09:00"]', "updated");
  legacy.close();
  let store = new SqliteStore(path);
  try {
    const original = await store.getEvent("legacy");
    assert.equal(original?.mode, "time");
    assert.equal(original?.startMin, 540);
    assert.deepEqual(allSlots(original!), ["2026-11-02T09:00", "2026-11-02T09:30"]);
    assert.deepEqual((await store.listParticipants("legacy"))[0].slots, ["2026-11-02T09:00"]);
    const dateEvent: EventRecord = { ...ev, adminKeyHash: "date-admin-hash" };
    await store.createEvent(dateEvent);
    store.close();
    store = new SqliteStore(path);
    assert.deepEqual(await store.getEvent(ev.id), dateEvent);
    assert.equal((await store.getEvent("legacy"))?.mode, "time");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("event APIs default legacy requests to time and accept date-only responses", async () => {
  const dir = mkdtempSync(join(tmpdir(), "when2meet-date-api-"));
  const previousPath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = join(dir, "api.db");
  const { getStore } = await import("./store");
  const { POST: createEvent } = await import("../app/api/events/route");
  const { POST: signIn } = await import("../app/api/events/[id]/participants/route");
  const { PUT: save } = await import("../app/api/events/[id]/availability/route");
  const request = (body: unknown, method = "POST") => new Request("http://localhost/api/events", {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const future = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const dates = [future(2), future(3), future(4)];
  const store = await getStore();
  try {
    const legacyResponse = await createEvent(request({ name: "Legacy", dates: [dates[0]], startMin: 540, endMin: 600, slotMinutes: 30 }));
    assert.equal(legacyResponse.status, 201);
    const legacy = await legacyResponse.json();
    assert.equal((await store.getEvent(legacy.id))?.mode, "time");

    const dateResponse = await createEvent(request({ name: "Dates", mode: "date", dates, startMin: 500, endMin: 600, slotMinutes: 30 }));
    assert.equal(dateResponse.status, 201);
    const { id } = await dateResponse.json();
    const created = await store.getEvent(id);
    assert.deepEqual([created?.mode, created?.startMin, created?.endMin, created?.slotMinutes], ["date", 0, 1440, 1440]);
    const context = { params: Promise.resolve({ id }) };
    const participant = await (await signIn(request({ name: "A" }), context)).json();
    const saved = await save(request({ ...participant, slots: [dates[1], dates[1], `${dates[1]}T00:00`, future(20)] }, "PUT"), context);
    assert.equal(saved.status, 200);
    assert.deepEqual((await saved.json()).slots, [dates[1]]);
    assert.deepEqual((await store.listParticipants(id))[0].slots, [dates[1]]);

    assert.equal((await createEvent(request({ name: "Bad", mode: "invalid", dates: ev.dates }))).status, 400);
    assert.equal((await createEvent(request({ name: "Bad", mode: "date", dates: ["2026-02-30"] }))).status, 400);
  } finally {
    (store as SqliteStore).close();
    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });
  }
});
