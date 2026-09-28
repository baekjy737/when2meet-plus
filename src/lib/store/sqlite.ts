import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { EventRecord, Participant } from "../types";
import type { EventStore } from "./index";

type EventRow = {
  id: string; name: string; dates: string; start_min: number; end_min: number;
  slot_minutes: number; timezone: string; admin_key_hash: string; created_at: string;
};
type ParticipantRow = {
  id: string; event_id: string; name: string; password_hash: string | null;
  session_hash: string; slots: string; updated_at: string;
};

export class SqliteStore implements EventStore {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, dates TEXT NOT NULL,
        start_min INTEGER NOT NULL, end_min INTEGER NOT NULL, slot_minutes INTEGER NOT NULL,
        timezone TEXT NOT NULL, admin_key_hash TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS participants (
        id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        name TEXT NOT NULL, password_hash TEXT, session_hash TEXT NOT NULL,
        slots TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE (event_id, name)
      );
    `);
  }

  async createEvent(ev: EventRecord) {
    this.db.prepare(
      `INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(ev.id, ev.name, JSON.stringify(ev.dates), ev.startMin, ev.endMin, ev.slotMinutes, ev.timezone, ev.adminKeyHash, ev.createdAt);
  }

  async getEvent(id: string): Promise<EventRecord | null> {
    const r = this.db.prepare(`SELECT * FROM events WHERE id = ?`).get(id) as EventRow | undefined;
    return r ? {
      id: r.id, name: r.name, dates: JSON.parse(r.dates), startMin: r.start_min, endMin: r.end_min,
      slotMinutes: r.slot_minutes, timezone: r.timezone, adminKeyHash: r.admin_key_hash, createdAt: r.created_at,
    } : null;
  }

  async listParticipants(eventId: string) {
    const rows = this.db.prepare(`SELECT * FROM participants WHERE event_id = ? ORDER BY name`).all(eventId) as ParticipantRow[];
    return rows.map(toParticipant);
  }

  async getParticipantByName(eventId: string, name: string) {
    const r = this.db.prepare(`SELECT * FROM participants WHERE event_id = ? AND name = ?`).get(eventId, name) as ParticipantRow | undefined;
    return r ? toParticipant(r) : null;
  }

  async upsertParticipant(p: Participant) {
    this.db.prepare(`
      INSERT INTO participants VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash,
        session_hash = excluded.session_hash, slots = excluded.slots, updated_at = excluded.updated_at
    `).run(p.id, p.eventId, p.name, p.passwordHash, p.sessionHash, JSON.stringify(p.slots), p.updatedAt);
  }
}

function toParticipant(r: ParticipantRow): Participant {
  return {
    id: r.id, eventId: r.event_id, name: r.name, passwordHash: r.password_hash,
    sessionHash: r.session_hash, slots: JSON.parse(r.slots), updatedAt: r.updated_at,
  };
}
