import { dateLabel, minToHHMM, parseSlot } from "@/lib/slots";
import type { PublicParticipant } from "@/lib/types";

export default function SlotDetail({ slot, people, slotMinutes }: { slot: string | null; people: PublicParticipant[]; slotMinutes: number }) {
  if (!slot) return <p className="muted">칸에 마우스를 올리거나 탭하면 가능한 사람이 표시됩니다.</p>;
  const { date, min } = parseSlot(slot);
  const yes = people.filter((p) => p.slots.includes(slot)).map((p) => p.name);
  const no = people.filter((p) => !p.slots.includes(slot)).map((p) => p.name);
  return (
    <div className="detail">
      <strong>{dateLabel(date)} {minToHHMM(min)}–{minToHHMM(min + slotMinutes)}</strong>
      <div className="cols">
        <div><h4>가능 {yes.length}</h4>{yes.map((n) => <div key={n}>{n}</div>)}</div>
        <div className="muted"><h4>불가 {no.length}</h4>{no.map((n) => <div key={n}>{n}</div>)}</div>
      </div>
    </div>
  );
}
