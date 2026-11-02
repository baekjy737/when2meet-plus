import type { EventRecord, Participant } from "../types";

export type ParticipantProof = { sessionHash?: string; passwordHash?: string; editKeyHash?: string };
export type AvailabilityUpdate =
  | { status: "saved" | "conflict"; participant: Participant }
  | { status: "unauthorized" };

/**
 * Persistence boundary. The SQLite implementation is used for self-hosting;
 * add a Firestore implementation here when moving to Vercel + Firebase.
 */
export interface EventStore {
  createEvent(ev: EventRecord): Promise<void>;
  getEvent(id: string): Promise<EventRecord | null>;
  listParticipants(eventId: string): Promise<Participant[]>;
  getParticipant(eventId: string, participantId: string): Promise<Participant | null>;
  getParticipantByName(eventId: string, name: string): Promise<Participant | null>;
  createParticipant(p: Participant): Promise<boolean>;
  hasParticipantSession(eventId: string, participantId: string, sessionHash: string): Promise<boolean>;
  grantParticipantSession(eventId: string, participantId: string, sessionHash: string, proof: ParticipantProof): Promise<boolean>;
  updateAvailability(eventId: string, participantId: string, sessionHash: string, revision: number, slots: string[]): Promise<AvailabilityUpdate>;
  deleteParticipant(eventId: string, participantId: string, sessionHash?: string): Promise<boolean>;
  setParticipantEditKey(eventId: string, participantId: string, sessionHash: string, editKeyHash: string): Promise<boolean>;
  recoverParticipant(eventId: string, participantId: string, editKeyHash: string): Promise<boolean>;
}

let store: Promise<EventStore> | undefined;

export async function getStore(): Promise<EventStore> {
  if (!store) {
    store = import("./sqlite").then(({ SqliteStore }) =>
      new SqliteStore(process.env.DATABASE_PATH ?? "./data/when2meet.db"),
    ).catch((error) => { store = undefined; throw error; });
  }
  return store;
}
