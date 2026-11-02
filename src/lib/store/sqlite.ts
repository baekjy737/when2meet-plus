import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { EventRecord, Participant } from "../types";
import type { AvailabilityUpdate, EventStore, ParticipantProof } from "./index";

type EventRow = {
  id: string; name: string; dates: string; start_min: number; end_min: number;
  slot_minutes: number; timezone: string; admin_key_hash: string; created_at: string;
  mode: EventRecord["mode"];
};
type ParticipantRow = {
  id: string; event_id: string; name: string; password_hash: string | null;
  session_hash: string; slots: string; updated_at: string;
  revision: number; edit_key_hash: string | null;
};

export class SqliteStore implements EventStore {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, dates TEXT NOT NULL,
        start_min INTEGER NOT NULL, end_min INTEGER NOT NULL, slot_minutes INTEGER NOT NULL,
        timezone TEXT NOT NULL, admin_key_hash TEXT NOT NULL, created_at TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'time'
      );
      CREATE TABLE IF NOT EXISTS participants (
        id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        name TEXT NOT NULL, password_hash TEXT, session_hash TEXT NOT NULL,
        slots TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE (event_id, name)
      );
      CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY);
    `);
    // Migrate old deployments in one transaction. Import legacy sessions only once:
    // re-importing session_hash after recovery would restore a revoked credential.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const eventColumns = this.db.prepare("PRAGMA table_info(events)").all() as { name: string }[];
      if (!eventColumns.some((column) => column.name === "mode")) {
        this.db.exec("ALTER TABLE events ADD COLUMN mode TEXT NOT NULL DEFAULT 'time'");
      }
      const participantColumns = this.db.prepare("PRAGMA table_info(participants)").all() as { name: string }[];
      if (!participantColumns.some((column) => column.name === "revision")) {
        this.db.exec("ALTER TABLE participants ADD COLUMN revision INTEGER NOT NULL DEFAULT 0");
      }
      if (!participantColumns.some((column) => column.name === "edit_key_hash")) {
        this.db.exec("ALTER TABLE participants ADD COLUMN edit_key_hash TEXT");
      }
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS participant_sessions (
          session_hash TEXT PRIMARY KEY,
          participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS participant_sessions_participant ON participant_sessions(participant_id);
      `);
      if (!this.db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get("participant-sessions-v1")) {
        this.db.exec(`INSERT OR IGNORE INTO participant_sessions (session_hash, participant_id, created_at)
          SELECT session_hash, id, updated_at FROM participants WHERE session_hash <> ''`);
        this.db.prepare("INSERT INTO schema_migrations VALUES (?)").run("participant-sessions-v1");
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close() { this.db.close(); }

  async createEvent(ev: EventRecord) {
    this.db.prepare(
      `INSERT INTO events (id, name, dates, start_min, end_min, slot_minutes, timezone, admin_key_hash, created_at, mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(ev.id, ev.name, JSON.stringify(ev.dates), ev.startMin, ev.endMin, ev.slotMinutes, ev.timezone, ev.adminKeyHash, ev.createdAt, ev.mode);
  }

  async getEvent(id: string): Promise<EventRecord | null> {
    const r = this.db.prepare(`SELECT * FROM events WHERE id = ?`).get(id) as EventRow | undefined;
    return r ? {
      id: r.id, name: r.name, mode: r.mode, dates: JSON.parse(r.dates), startMin: r.start_min, endMin: r.end_min,
      slotMinutes: r.slot_minutes, timezone: r.timezone, adminKeyHash: r.admin_key_hash, createdAt: r.created_at,
    } : null;
  }

  private readParticipant(eventId: string, participantId: string): Participant | null {
    const r = this.db.prepare("SELECT * FROM participants WHERE event_id = ? AND id = ?")
      .get(eventId, participantId) as ParticipantRow | undefined;
    return r ? toParticipant(r) : null;
  }

  async getParticipant(eventId: string, participantId: string) {
    return this.readParticipant(eventId, participantId);
  }

  async listParticipants(eventId: string) {
    return (this.db.prepare("SELECT * FROM participants WHERE event_id = ? ORDER BY name")
      .all(eventId) as ParticipantRow[]).map(toParticipant);
  }

  async getParticipantByName(eventId: string, name: string) {
    const r = this.db.prepare("SELECT * FROM participants WHERE event_id = ? AND name = ?")
      .get(eventId, name) as ParticipantRow | undefined;
    return r ? toParticipant(r) : null;
  }

  async createParticipant(p: Participant) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db.prepare(`INSERT INTO participants
        (id, event_id, name, password_hash, session_hash, slots, updated_at, revision, edit_key_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(event_id, name) DO NOTHING`)
        .run(p.id, p.eventId, p.name, p.passwordHash, p.sessionHash, JSON.stringify(p.slots), p.updatedAt, p.revision, p.editKeyHash);
      if (result.changes) {
        this.db.prepare("INSERT INTO participant_sessions VALUES (?, ?, ?)").run(p.sessionHash, p.id, p.updatedAt);
      }
      this.db.exec("COMMIT");
      return result.changes > 0;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private validSession(eventId: string, participantId: string, sessionHash: string) {
    return !!this.db.prepare(`SELECT 1 FROM participant_sessions s JOIN participants p ON p.id = s.participant_id
      WHERE p.event_id = ? AND p.id = ? AND s.session_hash = ?`).get(eventId, participantId, sessionHash);
  }

  async hasParticipantSession(eventId: string, participantId: string, sessionHash: string) {
    return this.validSession(eventId, participantId, sessionHash);
  }

  async grantParticipantSession(eventId: string, participantId: string, sessionHash: string, proof: ParticipantProof) {
    // Recheck proof in the INSERT itself so a recovery between the route's read
    // and this write cannot use an already-revoked token or edit link.
    const result = this.db.prepare(`INSERT INTO participant_sessions (session_hash, participant_id, created_at)
      SELECT ?, p.id, ? FROM participants p WHERE p.event_id = ? AND p.id = ? AND (
        EXISTS (SELECT 1 FROM participant_sessions s WHERE s.participant_id = p.id AND s.session_hash = ?)
        OR (? IS NOT NULL AND p.password_hash = ?) OR (? IS NOT NULL AND p.edit_key_hash = ?)
      )`).run(sessionHash, new Date().toISOString(), eventId, participantId, proof.sessionHash ?? "",
        proof.passwordHash ?? null, proof.passwordHash ?? null, proof.editKeyHash ?? null, proof.editKeyHash ?? null);
    return result.changes > 0;
  }

  async updateAvailability(eventId: string, participantId: string, sessionHash: string, revision: number, slots: string[]): Promise<AvailabilityUpdate> {
    // Keep the acknowledgement's revision/snapshot together with the write.
    // A second process must not advance the revision between UPDATE and SELECT.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db.prepare(`UPDATE participants SET slots = ?, revision = revision + 1, updated_at = ?
        WHERE event_id = ? AND id = ? AND revision = ? AND EXISTS (
          SELECT 1 FROM participant_sessions s WHERE s.participant_id = participants.id AND s.session_hash = ?
        )`).run(JSON.stringify(slots), new Date().toISOString(), eventId, participantId, revision, sessionHash);
      const participant = this.readParticipant(eventId, participantId);
      const response: AvailabilityUpdate = result.changes && participant
        ? { status: "saved", participant }
        : participant && this.validSession(eventId, participantId, sessionHash)
          ? { status: "conflict", participant }
          : { status: "unauthorized" };
      this.db.exec("COMMIT");
      return response;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async deleteParticipant(eventId: string, participantId: string, sessionHash?: string) {
    const result = sessionHash === undefined
      ? this.db.prepare("DELETE FROM participants WHERE event_id = ? AND id = ?").run(eventId, participantId)
      : this.db.prepare(`DELETE FROM participants WHERE event_id = ? AND id = ? AND EXISTS (
          SELECT 1 FROM participant_sessions s WHERE s.participant_id = participants.id AND s.session_hash = ?
        )`).run(eventId, participantId, sessionHash);
    return result.changes > 0;
  }

  async setParticipantEditKey(eventId: string, participantId: string, sessionHash: string, editKeyHash: string) {
    return this.db.prepare(`UPDATE participants SET edit_key_hash = ? WHERE event_id = ? AND id = ? AND EXISTS (
      SELECT 1 FROM participant_sessions s WHERE s.participant_id = participants.id AND s.session_hash = ?
    )`).run(editKeyHash, eventId, participantId, sessionHash).changes > 0;
  }

  async recoverParticipant(eventId: string, participantId: string, editKeyHash: string) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db.prepare("UPDATE participants SET edit_key_hash = ?, session_hash = '' WHERE event_id = ? AND id = ?")
        .run(editKeyHash, eventId, participantId);
      if (result.changes) this.db.prepare("DELETE FROM participant_sessions WHERE participant_id = ?").run(participantId);
      this.db.exec("COMMIT");
      return result.changes > 0;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

function toParticipant(r: ParticipantRow): Participant {
  return {
    id: r.id, eventId: r.event_id, name: r.name, passwordHash: r.password_hash,
    sessionHash: r.session_hash, slots: JSON.parse(r.slots), updatedAt: r.updated_at,
    revision: r.revision, editKeyHash: r.edit_key_hash,
  };
}
