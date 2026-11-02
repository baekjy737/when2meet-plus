import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sha256 } from "./crypto";
import { SqliteStore } from "./store/sqlite";
import type { EventRecord, Participant } from "./types";

const event = (id: string): EventRecord => ({ id, name: id, mode: "time", dates: ["2026-11-02"],
  startMin: 540, endMin: 600, slotMinutes: 30, timezone: "Asia/Seoul", adminKeyHash: sha256("admin"), createdAt: "" });
const person = (eventId: string, id = "person"): Participant => ({ id, eventId, name: id,
  passwordHash: null, sessionHash: sha256("original"), slots: [], updatedAt: "", revision: 0, editKeyHash: null });

// Each test file gets its own process; the route singleton only sees this temporary DB.
const dir = mkdtempSync(join(tmpdir(), "when2meet-participant-access-"));
const previousPath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(dir, "routes.db");
let store: import("./store").EventStore;
import { getStore } from "./store";
import { POST as signIn } from "../app/api/events/[id]/participants/route";
import { GET as snapshot, PUT as save } from "../app/api/events/[id]/availability/route";
import { DELETE as remove } from "../app/api/events/[id]/participants/[pid]/route";
import { POST as editLink } from "../app/api/events/[id]/participants/[pid]/edit-link/route";
import { POST as recover } from "../app/api/events/[id]/participants/[pid]/recovery/route";
import { loadEvent } from "./server";
before(async () => { store = await getStore(); });
after(() => {
  (store as SqliteStore).close();
  if (previousPath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = previousPath;
  rmSync(dir, { recursive: true, force: true });
});

const request = (body?: unknown, token?: string, method = "POST", query = "") => new Request(`http://localhost/api${query}`, {
  method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const context = (id: string, pid = "") => ({ params: Promise.resolve({ id, pid }) });
async function joinEvent(id: string, name: string, password = "") {
  return signIn(request({ name, password }), context(id));
}
async function read(id: string, participantId: string, token: string) {
  return snapshot(request(undefined, token, "GET", `?participantId=${participantId}`), context(id));
}

test("legacy session migration preserves original tokens once and never resurrects revoked tokens", async () => {
  const path = join(dir, "legacy.db");
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE events (id TEXT PRIMARY KEY, name TEXT NOT NULL, dates TEXT NOT NULL,
    start_min INTEGER NOT NULL, end_min INTEGER NOT NULL, slot_minutes INTEGER NOT NULL,
    timezone TEXT NOT NULL, admin_key_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE participants (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id),
    name TEXT NOT NULL, password_hash TEXT, session_hash TEXT NOT NULL, slots TEXT NOT NULL,
    updated_at TEXT NOT NULL, UNIQUE(event_id, name));`);
  legacy.prepare("INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?)").run("old", "old", '["2026-11-02"]', 540, 600, 30, "Asia/Seoul", sha256("admin"), "");
  legacy.prepare("INSERT INTO participants VALUES (?,?,?,?,?,?,?)").run("old-person", "old", "A", null, sha256("old-token"), '["2026-11-02T09:00"]', "");
  legacy.close();
  let migrated = new SqliteStore(path);
  assert.equal(await migrated.hasParticipantSession("old", "old-person", sha256("old-token")), true);
  assert.deepEqual((await migrated.getParticipant("old", "old-person"))?.slots, ["2026-11-02T09:00"]);
  assert.equal((await migrated.getParticipant("old", "old-person"))?.revision, 0);
  migrated.close();
  // Revoke the migrated session while leaving the old compatibility column intact.
  // A migration that runs on every startup would incorrectly restore this token.
  const revoked = new DatabaseSync(path);
  revoked.prepare("DELETE FROM participant_sessions WHERE participant_id = ?").run("old-person");
  revoked.close();
  migrated = new SqliteStore(path);
  assert.equal(await migrated.hasParticipantSession("old", "old-person", sha256("old-token")), false);
  await migrated.recoverParticipant("old", "old-person", sha256("recover"));
  assert.equal(await migrated.grantParticipantSession("old", "old-person", sha256("new"), { editKeyHash: sha256("recover") }), true);
  migrated.close();
});

test("same-name registration cannot claim an existing unprotected response or invalidate its session", async () => {
  const id = "protected";
  await store.createEvent(event(id));
  const created = await joinEvent(id, "A");
  assert.equal(created.status, 201);
  const a = await created.json();
  const intrusion = await joinEvent(id, " A ");
  assert.equal(intrusion.status, 409);
  assert.equal((await intrusion.json()).code, "RESPONSE_PROTECTED");
  assert.equal((await read(id, a.participantId, a.token)).status, 200);
  const publicData = await loadEvent(id);
  assert.deepEqual(Object.keys(publicData!.people[0]).sort(), ["id", "name", "revision", "slots"]);
});

test("authorized added sessions coexist and stale full-response writes conflict", async () => {
  const id = "sessions";
  await store.createEvent(event(id));
  const a = await (await joinEvent(id, "A")).json();
  const newSession = await signIn(request({ participantId: a.participantId, token: a.token }), context(id));
  assert.equal(newSession.status, 200);
  const b = await newSession.json();
  assert.notEqual(a.token, b.token);
  const first = await save(request({ ...a, slots: ["2026-11-02T09:00", "bad", "2026-11-02T09:00"] }, undefined, "PUT"), context(id));
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true, slots: ["2026-11-02T09:00"], revision: 1 });
  const stale = await save(request({ ...b, slots: ["2026-11-02T09:30"] }, undefined, "PUT"), context(id));
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), {
    code: "REVISION_CONFLICT", error: "다른 기기에서 응답이 변경되었습니다. 최신 응답을 불러온 뒤 다시 선택해 주세요.",
    slots: ["2026-11-02T09:00"], revision: 1,
  });
  const latest = await (await read(id, a.participantId, b.token)).json();
  const updated = await save(request({ ...b, revision: latest.revision, slots: ["2026-11-02T09:30"] }, undefined, "PUT"), context(id));
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).revision, 2);
  assert.equal((await read(id, a.participantId, a.token)).status, 200);
});

test("password re-entry preserves other devices and rejects missing or incorrect passwords", async () => {
  const id = "password";
  await store.createEvent(event(id));
  const a = await (await joinEvent(id, "A", "correct")).json();
  assert.equal((await joinEvent(id, "A", "wrong")).status, 401);
  assert.equal((await joinEvent(id, "A")).status, 401);
  const b = await (await joinEvent(id, "A", "correct")).json();
  assert.equal((await read(id, a.participantId, a.token)).status, 200);
  assert.equal((await read(id, b.participantId, b.token)).status, 200);
});

test("private edit links require ownership, rotate independently, and allow a new device", async () => {
  const id = "edit-link";
  await store.createEvent(event(id));
  const a = await (await joinEvent(id, "A")).json();
  const other = await (await joinEvent(id, "B")).json();
  assert.equal((await editLink(request(undefined, other.token), context(id, a.participantId))).status, 401);
  const firstKey = await (await editLink(request(undefined, a.token), context(id, a.participantId))).json();
  const linkSession = await signIn(request({ participantId: a.participantId, editKey: firstKey.editKey }), context(id));
  assert.equal(linkSession.status, 200);
  assert.equal((await linkSession.json()).name, "A");
  const secondKey = await (await editLink(request(undefined, a.token), context(id, a.participantId))).json();
  assert.notEqual(firstKey.editKey, secondKey.editKey);
  assert.equal((await signIn(request({ participantId: a.participantId, editKey: firstKey.editKey }), context(id))).status, 401);
  assert.equal((await read(id, a.participantId, a.token)).status, 200);
});

test("administrator recovery revokes every old session and edit link", async () => {
  const id = "recovery";
  await store.createEvent(event(id));
  const a = await (await joinEvent(id, "A")).json();
  const b = await (await signIn(request({ participantId: a.participantId, token: a.token }), context(id))).json();
  const oldKey = await (await editLink(request(undefined, a.token), context(id, a.participantId))).json();
  assert.equal((await recover(request(undefined, a.token), context(id, a.participantId))).status, 403);
  const recovered = await recover(request(undefined, "admin"), context(id, a.participantId));
  assert.equal(recovered.status, 200);
  const { editKey } = await recovered.json();
  for (const token of [a.token, b.token]) {
    assert.equal((await read(id, a.participantId, token)).status, 401);
    assert.equal((await signIn(request({ participantId: a.participantId, token }), context(id))).status, 401);
  }
  assert.equal((await signIn(request({ participantId: a.participantId, editKey: oldKey.editKey }), context(id))).status, 401);
  assert.equal((await signIn(request({ participantId: a.participantId, editKey }), context(id))).status, 200);
});

test("deletion rejects another participant and delayed saves cannot recreate the removed response", async () => {
  const id = "delete";
  await store.createEvent(event(id));
  const a = await (await joinEvent(id, "A")).json();
  const b = await (await joinEvent(id, "B")).json();
  assert.equal((await remove(request(undefined, b.token, "DELETE"), context(id, a.participantId))).status, 401);
  assert.equal((await remove(request(undefined, "admin", "DELETE"), context(id, a.participantId))).status, 200);
  assert.equal((await save(request({ ...a, slots: ["2026-11-02T09:00"] }, undefined, "PUT"), context(id))).status, 401);
  assert.equal(await store.getParticipant(id, a.participantId), null);
  const replacement = await (await joinEvent(id, "A")).json();
  assert.notEqual(a.participantId, replacement.participantId);
  assert.equal((await read(id, replacement.participantId, a.token)).status, 401);
  assert.equal((await remove(request(undefined, replacement.token, "DELETE"), context(id, replacement.participantId))).status, 200);
});

test("missing revisions cannot bypass conflict checking and foreign event tokens have no authority", async () => {
  const id = "revision";
  await store.createEvent(event(id));
  const a = await (await joinEvent(id, "A")).json();
  const response = await save(request({ participantId: a.participantId, token: a.token, slots: [] }, undefined, "PUT"), context(id));
  assert.equal(response.status, 428);
  assert.equal((await response.json()).code, "REFRESH_REQUIRED");
  assert.equal((await store.getParticipant(id, a.participantId))?.revision, 0);
  assert.equal((await read("other-event", a.participantId, a.token)).status, 401);
  assert.equal((await editLink(request(undefined, a.token), context("other-event", a.participantId))).status, 401);
});

test("simultaneous first participation never overwrites the winning identity", async () => {
  const id = "register-race";
  await store.createEvent(event(id));
  const attempts = await Promise.all([joinEvent(id, "Same"), joinEvent(id, "Same")]);
  assert.deepEqual(attempts.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await store.listParticipants(id)).length, 1);
  const winner = await attempts.find((r) => r.status === 201)!.json();
  assert.equal((await read(id, winner.participantId, winner.token)).status, 200);
});

test("storage rechecks session/edit proof and revision at mutation time across database connections", async () => {
  const path = join(dir, "race.db");
  const one = new SqliteStore(path);
  const two = new SqliteStore(path);
  try {
    await one.createEvent(event("race"));
    await one.createParticipant(person("race"));
    const stale = await one.getParticipant("race", "person");
    assert.ok(stale);
    const results = await Promise.all([
      one.updateAvailability("race", "person", sha256("original"), 0, ["2026-11-02T09:00"]),
      two.updateAvailability("race", "person", sha256("original"), 0, ["2026-11-02T09:30"]),
    ]);
    assert.deepEqual(results.map((r) => r.status), ["saved", "conflict"]);
    await one.setParticipantEditKey("race", "person", sha256("original"), sha256("old-link"));
    await two.recoverParticipant("race", "person", sha256("new-link"));
    assert.equal(await one.grantParticipantSession("race", "person", sha256("new-session"), { sessionHash: stale.sessionHash }), false);
    assert.equal(await one.grantParticipantSession("race", "person", sha256("new-session"), { editKeyHash: sha256("old-link") }), false);
    assert.equal((await one.updateAvailability("race", "person", stale.sessionHash, 1, [])).status, "unauthorized");
    await two.deleteParticipant("race", "person");
    assert.equal((await one.updateAvailability("race", "person", stale.sessionHash, 1, [])).status, "unauthorized");
    assert.equal(await one.getParticipant("race", "person"), null);
  } finally { one.close(); two.close(); }
});
