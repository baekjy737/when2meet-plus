import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { exportCsv, exportJson, exportXlsx } from "./export";
import { defaultMeetingDuration } from "./event-options";
import { allSlots } from "./slots";
import { sha256 } from "./crypto";
import type { PublicEvent } from "./types";
import type { SqliteStore } from "./store/sqlite";

const event: PublicEvent = {
  id: "export", name: "회의", mode: "time", dates: ["2026-11-03"], startMin: 540, endMin: 660,
  slotMinutes: 30, timezone: "Asia/Seoul", createdAt: "",
};
const people = [
  { id: "a", name: "A", slots: allSlots(event) },
  { id: "b", name: "B & B", slots: ["2026-11-03T09:30", "2026-11-03T10:00"] },
];

test("screen and export defaults fit short events and retain one-hour defaults otherwise", () => {
  for (const minutes of [15, 30, 45, 60, 120]) {
    const short = { ...event, slotMinutes: 15, endMin: event.startMin + minutes };
    assert.equal(defaultMeetingDuration(short), Math.min(minutes, 60));
    const json = exportJson(short, [{ id: "a", name: "A", slots: allSlots(short) }], {});
    assert.equal(json.bestTimes.length > 0, true);
    assert.equal("minutes" in json.bestTimes[0] ? json.bestTimes[0].minutes : -1, Math.min(minutes, 60));
  }
  assert.equal(defaultMeetingDuration({ ...event, mode: "date", slotMinutes: 1440 }), 1440);
});

test("XLSX and JSON export the same required-attendee, duration, headcount and limit conditions", async () => {
  const options = { durationMin: 30, minPeople: 2, required: ["B & B"], limit: 1 };
  const json = exportJson(event, people, options);
  assert.deepEqual(json.bestTimes, [{ date: event.dates[0], start: "09:30", end: "10:00", minutes: 30, available: ["A", "B & B"], unavailable: [] }]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(await exportXlsx(event, people, options)).buffer);
  const best = workbook.worksheets[0];
  assert.equal(best.rowCount, 2);
  assert.equal(best.getCell("C2").value, "09:30");
  assert.equal(best.getCell("D2").value, "10:00");
  assert.equal(best.getCell("E2").value, 2);
  assert.equal(best.getCell("G2").value, "A, B & B");
  assert.equal(exportCsv(event, people).split("\r\n").length, allSlots(event).length + 2);
});

test("continuous export merges all candidates before applying result limit", async () => {
  const options = { durationMin: 30, minPeople: 1, required: ["A"], limit: 1, mergeContinuous: true };
  const json = exportJson(event, people.slice(0, 1), options);
  assert.deepEqual(json.bestTimes, [{ date: event.dates[0], start: "09:00", end: "11:00", minutes: 120, available: ["A"], unavailable: [] }]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(await exportXlsx(event, people.slice(0, 1), options)).buffer);
  assert.equal(workbook.worksheets[0].getCell("D2").value, "11:00");
});

test("export API authenticates and safely accepts repeated required names, preserving slot CSV", async () => {
  const directory = mkdtempSync(join(tmpdir(), "when2meet-export-api-"));
  const previousPath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = join(directory, "test.db");
  const { getStore } = await import("./store");
  const { POST: signIn } = await import("../app/api/events/[id]/participants/route");
  const { PUT: save } = await import("../app/api/events/[id]/availability/route");
  const { GET: download } = await import("../app/api/events/[id]/export/route");
  const context = { params: Promise.resolve({ id: event.id }) };
  const request = (body: unknown, method = "POST") => new Request("http://localhost/api/events", {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const get = (query: URLSearchParams, authenticated = true) => download(new Request(`http://localhost/api/events/export/export?${query}`, {
    headers: authenticated ? { Authorization: "Bearer secret" } : {},
  }), context);
  const store = await getStore();
  try {
    await store.createEvent({ ...event, adminKeyHash: sha256("secret") });
    for (const person of people) {
      const credentials = await (await signIn(request({ name: person.name }), context)).json();
      assert.equal((await save(request({ ...credentials, slots: person.slots }, "PUT"), context)).status, 200);
    }
    const query = new URLSearchParams({ format: "json", duration: "30", minPeople: "2", limit: "20" });
    query.append("required", "A");
    query.append("required", "B & B");
    assert.equal((await get(query, false)).status, 401);
    const response = await get(query);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.bestTimes.length, 2);
    assert.ok(data.bestTimes.every((block: { available: string[] }) => block.available.includes("B & B")));
    query.set("format", "xlsx");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await (await get(query)).arrayBuffer());
    assert.equal(workbook.worksheets[0].rowCount, data.bestTimes.length + 1);
    const defaults = await (await get(new URLSearchParams({ format: "json" }))).json();
    assert.equal(defaults.bestTimes[0].minutes, 60);
    const invalidQueries: Record<string, string>[] = [
      { duration: "0" }, { duration: "45" }, { duration: "150" }, { limit: "-1" }, { limit: "1.5" },
      { limit: "Infinity" }, { limit: "10001" }, { minPeople: "NaN" }, { required: "Unknown" }, { merge: "yes" },
    ];
    for (const params of invalidQueries) assert.equal((await get(new URLSearchParams(params))).status, 400, JSON.stringify(params));
    assert.equal((await get(new URLSearchParams("duration=30&duration=60"))).status, 400);
    const csv = await (await get(new URLSearchParams({ format: "csv", duration: "0", required: "Unknown" }))).text();
    assert.ok(csv.includes("09:00,09:30,1,2,A,B & B"));
    assert.equal(csv.split("\r\n").length, allSlots(event).length + 2);
  } finally {
    (store as SqliteStore).close();
    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
