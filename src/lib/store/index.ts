import type { EventRecord, Participant } from "../types";

/**
 * Persistence boundary. The SQLite implementation is used for self-hosting;
 * add a Firestore implementation here when moving to Vercel + Firebase.
 */
export interface EventStore {
  createEvent(ev: EventRecord): Promise<void>;
  getEvent(id: string): Promise<EventRecord | null>;
  listParticipants(eventId: string): Promise<Participant[]>;
  getParticipantByName(eventId: string, name: string): Promise<Participant | null>;
  upsertParticipant(p: Participant): Promise<void>;
}

let store: EventStore | undefined;

export async function getStore(): Promise<EventStore> {
  if (!store) {
    const { SqliteStore } = await import("./sqlite");
    store = new SqliteStore(process.env.DATABASE_PATH ?? "./data/when2meet.db");
  }
  return store;
}
