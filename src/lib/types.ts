export type EventMode = "time" | "date";

export type EventRecord = {
  id: string;
  name: string;
  /** Choose whole dates or individual time slots. */
  mode: EventMode;
  /** Local dates in YYYY-MM-DD, sorted. */
  dates: string[];
  /** Minutes from midnight, inclusive start / exclusive end. */
  startMin: number;
  endMin: number;
  slotMinutes: number;
  /** IANA timezone label; slot times are interpreted in this zone. */
  timezone: string;
  adminKeyHash: string;
  createdAt: string;
};

export type Participant = {
  id: string;
  eventId: string;
  name: string;
  passwordHash: string | null;
  sessionHash: string;
  /** Version of the full availability response, used for conditional writes. */
  revision: number;
  /** Hash of the private response-editing link. Never exposed publicly. */
  editKeyHash: string | null;
  /** Available slot ids: "YYYY-MM-DDTHH:MM" in time mode, "YYYY-MM-DD" in date mode. */
  slots: string[];
  updatedAt: string;
};

export type PublicEvent = Omit<EventRecord, "adminKeyHash">;
export type PublicParticipant = { id: string; name: string; slots: string[]; revision?: number };
