import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { dateInTimezone, isValidTimezone, validateEventInput } from "./event-validation";
import { sha256 } from "./crypto";
import type { SqliteStore } from "./store/sqlite";

const midnightBoundary = new Date("2026-11-02T15:30:00Z");
const input = { name: "회의", mode: "time", dates: ["2026-11-03"], startMin: 540, endMin: 600, slotMinutes: 30, timezone: "Asia/Seoul" };

test("today uses the selected event timezone, including the Korean midnight boundary", () => {
  assert.equal(dateInTimezone("Asia/Seoul", midnightBoundary), "2026-11-03");
  assert.equal(dateInTimezone("UTC", midnightBoundary), "2026-11-02");
  assert.equal(dateInTimezone("America/Los_Angeles", midnightBoundary), "2026-11-02");
  for (const mode of ["time", "date"]) {
    assert.equal(validateEventInput({ ...input, mode }, midnightBoundary).ok, true);
    assert.equal(validateEventInput({ ...input, mode, dates: ["2026-11-02"] }, midnightBoundary).ok, false);
    assert.equal(validateEventInput({ ...input, mode, dates: ["2026-11-02"], timezone: "UTC" }, midnightBoundary).ok, true);
    assert.equal(validateEventInput({ ...input, mode, dates: ["2026-11-02", "2026-11-04"] }, midnightBoundary).ok, false);
  }
});

test("new events require real dates and a supported named timezone", () => {
  for (const timezone of ["Asia/Seoul", "UTC", "America/New_York", "Pacific/Kiritimati"]) assert.equal(isValidTimezone(timezone), true);
  for (const timezone of ["", "Unknown/Nowhere", "+09:00", "Asia/Seoul ", null, 9]) {
    assert.equal(isValidTimezone(timezone), false);
    assert.equal(validateEventInput({ ...input, timezone }, midnightBoundary).ok, false);
  }
  for (const dates of [[], ["2026-02-30"], ["2026-11-03", "not-a-date"], [3], null]) {
    assert.equal(validateEventInput({ ...input, dates }, midnightBoundary).ok, false);
  }
  const dates = Array.from({ length: 63 }, (_, index) => new Date(Date.parse("2026-11-03T00:00:00Z") + index * 86_400_000).toISOString().slice(0, 10));
  assert.equal(validateEventInput({ ...input, dates: dates.slice(0, 62) }, midnightBoundary).ok, true);
  assert.equal(validateEventInput({ ...input, dates }, midnightBoundary).ok, false);
});

test("minute-aligned starts and 24:00 are accepted without rounding invalid steps", () => {
  for (const [startMin, endMin, slotMinutes] of [[555, 600, 15], [570, 600, 30], [1425, 1440, 15], [0, 1440, 60]]) {
    const result = validateEventInput({ ...input, startMin, endMin, slotMinutes }, midnightBoundary);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual([result.value.startMin, result.value.endMin], [startMin, endMin]);
  }
  for (const [startMin, endMin, slotMinutes] of [[570, 600, 60], [540, 585, 30], [540, 540, 30], [-30, 60, 30], [540, 1500, 30], [540, 600, 20]]) {
    assert.equal(validateEventInput({ ...input, startMin, endMin, slotMinutes }, midnightBoundary).ok, false);
  }
  const dateMode = validateEventInput({ ...input, mode: "date", startMin: 570, slotMinutes: 60 }, midnightBoundary);
  assert.equal(dateMode.ok, true);
  if (dateMode.ok) assert.deepEqual([dateMode.value.startMin, dateMode.value.endMin, dateMode.value.slotMinutes], [0, 1440, 1440]);
});

test("creation API blocks past dates in both modes while existing past responses remain editable", async () => {
  const directory = mkdtempSync(join(tmpdir(), "when2meet-create-api-"));
  const previousPath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = join(directory, "test.db");
  const { getStore } = await import("./store");
  const { POST: create } = await import("../app/api/events/route");
  const { POST: signIn } = await import("../app/api/events/[id]/participants/route");
  const { PUT: save } = await import("../app/api/events/[id]/availability/route");
  const { GET: read } = await import("../app/api/events/[id]/route");
  const request = (body: unknown, method = "POST") => new Request("http://localhost/api/events", {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const today = dateInTimezone("UTC");
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const store = await getStore();
  try {
    for (const mode of ["time", "date"]) {
      const body = { ...input, mode, timezone: "UTC" };
      assert.equal((await create(request({ ...body, dates: [today] }))).status, 201);
      assert.equal((await create(request({ ...body, dates: [yesterday] }))).status, 400);
    }
    assert.equal((await create(request({ ...input, dates: [today], timezone: "Invalid/Zone" }))).status, 400);
    await store.createEvent({
      ...input, mode: "time", id: "historic", dates: [yesterday], timezone: "UTC", adminKeyHash: sha256("admin"), createdAt: "",
    });
    const context = { params: Promise.resolve({ id: "historic" }) };
    assert.equal((await read(new Request("http://localhost/api/events/historic"), context)).status, 200);
    const person = await (await signIn(request({ name: "Past attendee" }), context)).json();
    const saved = await save(request({ ...person, slots: [`${yesterday}T09:00`] }, "PUT"), context);
    assert.equal(saved.status, 200);
    assert.deepEqual((await saved.json()).slots, [`${yesterday}T09:00`]);
  } finally {
    (store as SqliteStore).close();
    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
