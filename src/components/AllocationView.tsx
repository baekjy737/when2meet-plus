"use client";

import { useMemo, useState } from "react";
import { allocateTime, type AllocationBlock, type AllocationResult } from "@/lib/allocation";
import { exportAllocationCsv } from "@/lib/allocation-export";
import { dateLabel } from "@/lib/slots";
import type { PublicEvent, PublicParticipant } from "@/lib/types";

type Props = {
  event: PublicEvent;
  people: PublicParticipant[];
  picked: AllocationBlock | null;
  onPick: (block: AllocationBlock | null) => void;
};

type Snapshot = {
  result: AllocationResult;
  sourceKey: string;
  durationMin: number;
  minPeople: number;
};

function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}시간${rest ? ` ${rest}분` : ""}` : `${rest}분`;
}

export default function AllocationView({ event, people, picked, onPick }: Props) {
  const dayMinutes = event.endMin - event.startMin;
  const maxDuration = Math.floor(dayMinutes / event.slotMinutes) * event.slotMinutes;
  const [duration, setDuration] = useState(Math.min(maxDuration, Math.max(event.slotMinutes, 60)));
  const [minimum, setMinimum] = useState("1");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const minPeople = Number(minimum);
  const validMinimum = minimum.trim() !== "" && Number.isSafeInteger(minPeople) && minPeople >= 1;
  const validDuration = Number.isSafeInteger(duration) && duration >= event.slotMinutes && duration <= dayMinutes && duration % event.slotMinutes === 0;
  const valid = validMinimum && validDuration;
  const durations = useMemo(() => Array.from({ length: Math.floor(dayMinutes / event.slotMinutes) }, (_, i) => (i + 1) * event.slotMinutes), [dayMinutes, event.slotMinutes]);

  // Ignore response order and slot order: polling an unchanged event must not
  // mark the generated plan stale or replace its assignments.
  const sourceKey = useMemo(() => JSON.stringify({
    eventId: event.id, dates: event.dates, startMin: event.startMin, endMin: event.endMin, slotMinutes: event.slotMinutes,
    people: people.map((person) => ({ id: person.id, name: person.name, slots: [...person.slots].sort() })).sort((a, b) => a.id.localeCompare(b.id)),
  }), [event, people]);
  const responsesChanged = !!snapshot && snapshot.sourceKey !== sourceKey;
  const optionsChanged = !!snapshot && (snapshot.durationMin !== duration || snapshot.minPeople !== minPeople || !valid);
  const groups = useMemo(() => {
    const grouped = new Map<string, AllocationBlock[]>();
    for (const block of snapshot?.result.blocks ?? []) {
      const existing = grouped.get(block.date) ?? [];
      existing.push(block);
      grouped.set(block.date, existing);
    }
    return [...grouped];
  }, [snapshot]);

  function generate() {
    if (!valid) return;
    setError("");
    try {
      const result = allocateTime(event, people, { durationMin: duration, minPeople });
      setSnapshot({ result, sourceKey, durationMin: duration, minPeople });
      onPick(null);
    } catch {
      setError("배분안을 만들지 못했습니다. 배분 단위와 최소 인원을 확인해 주세요.");
    }
  }

  function download() {
    if (!snapshot) return;
    const blob = new Blob([exportAllocationCsv(snapshot.result)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement("a"), { href: url, download: `${event.name}-${event.id}-TF-배분안.csv` });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const result = snapshot?.result;
  const shortBlocks = result?.blocks.filter((block) => block.missing > 0).length ?? 0;
  const assignedPeople = result?.people.filter((person) => person.count > 0).length ?? 0;

  return (
    <div className="allocation-view">
      <h2>TF 시간 배분</h2>
      <p className="muted small">각 날짜의 시작부터 겹치지 않는 시간대로 나눕니다. 해당 시간 내내 가능한 사람을 배분하고, 여러 번 참여할 수 있는 사람도 배분 횟수가 고르게 되도록 조정합니다.</p>

      <form onSubmit={(e) => { e.preventDefault(); generate(); }}>
        <div className="filters allocation-filters">
          <label className="field">
            <span>배분 단위</span>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {durations.map((minutes) => <option key={minutes} value={minutes}>{durationLabel(minutes)}</option>)}
            </select>
          </label>
          <label className="field">
            <span>시간대별 최소 인원</span>
            <input type="number" min={1} max={Number.MAX_SAFE_INTEGER} step={1} value={minimum} required
              onChange={(e) => setMinimum(e.target.value)} aria-invalid={!validMinimum} aria-describedby="allocation-minimum-help" />
          </label>
        </div>
        <p className={validMinimum ? "muted small" : "error small"} id="allocation-minimum-help">
          {validMinimum ? "가능한 사람이 충분하면 최소 인원만큼 배분합니다. 부족한 시간대도 결과에 표시합니다." : "최소 인원은 1 이상의 정수로 입력해 주세요."}
        </p>
        <button type="submit" className="primary" disabled={!valid}>{snapshot ? "다시 계산" : "배분안 만들기"}</button>
      </form>

      {error && <p className="error" role="alert">{error}</p>}
      {(responsesChanged || optionsChanged) && (
        <div className="allocation-notice" role="status">
          <strong>{responsesChanged && optionsChanged ? "응답과 배분 조건이 바뀌었습니다." : responsesChanged ? "참가자 응답이 바뀌었습니다." : "배분 조건이 바뀌었습니다."}</strong>
          <p>현재 결과와 CSV는 이전 배분안입니다. 위의 ‘다시 계산’을 누르면 최신 내용으로 갱신합니다.</p>
        </div>
      )}

      {!result || !snapshot ? (
        <p className="muted allocation-empty">조건을 정하고 배분안을 만들어 보세요. 계산한 결과는 이 화면에서 검토할 수 있습니다.</p>
      ) : (
        <div className="allocation-result">
          <div className="allocation-result-head">
            <div>
              <h3>배분 결과</h3>
              <p className="muted small">{durationLabel(snapshot.durationMin)} 단위 · 시간대별 최소 {snapshot.minPeople}명</p>
            </div>
            <button type="button" onClick={download}>TF 배분 CSV</button>
          </div>
          <p className="muted small">현재 응답을 바탕으로 만든 검토용 배분안입니다. 결과를 확인하고 최종 일정을 정하세요.</p>
          <dl className="allocation-summary">
            <div><dt>전체 시간대</dt><dd>{result.blocks.length}개</dd></div>
            <div><dt>인원 충족</dt><dd>{result.blocks.length - shortBlocks}개</dd></div>
            <div><dt>인원 부족</dt><dd className={shortBlocks ? "error" : ""}>{shortBlocks}개</dd></div>
            <div><dt>배분된 사람</dt><dd>{assignedPeople}/{result.people.length}명</dd></div>
          </dl>
          {result.balanceLimited && <p className="allocation-notice" role="status">가능한 시간과 필요한 인원에 맞춰 배분했지만, 사람별 횟수를 충분히 고르게 조정하지 못했습니다. 개인별 결과를 확인해 주세요.</p>}
          {result.blocks.length === 0 && <p className="muted">현재 배분 단위로 나눌 수 있는 시간대가 없습니다.</p>}

          {groups.map(([date, blocks]) => (
            <section className="allocation-day" key={date} aria-label={`${date} 배분안`}>
              <h3>{date.slice(0, 4)}년 {dateLabel(date)}</h3>
              <ol className="allocation-blocks">
                {blocks.map((block) => {
                  const assignedIds = new Set(block.assigned.map((person) => person.id));
                  const backups = block.eligible.filter((person) => !assignedIds.has(person.id));
                  const on = picked?.id === block.id;
                  return (
                    <li key={block.id} className={`allocation-block${on ? " on" : ""}${block.missing ? " understaffed" : ""}`}>
                      <button type="button" className="allocation-block-pick" aria-pressed={on}
                        aria-label={`${dateLabel(date)} ${block.start}–${block.end}, ${block.assigned.length}명 배분${block.missing ? `, ${block.missing}명 부족` : ""}, 시간표에서 보기`}
                        onClick={() => onPick(on ? null : block)}>
                        <strong>{block.start}–{block.end}</strong>
                        <span>{block.assigned.length}/{snapshot.minPeople}명</span>
                      </button>
                      <p className="allocation-names"><strong>배분:</strong> {block.assigned.length ? block.assigned.map((person) => person.name).join(", ") : "없음"}</p>
                      {block.missing > 0 && <p className="allocation-shortage">{block.missing}명 부족</p>}
                      {backups.length > 0 ? (
                        <details className="allocation-backups"><summary>대체 가능한 사람 {backups.length}명</summary><p>{backups.map((person) => person.name).join(", ")}</p></details>
                      ) : <p className="muted small">대체 가능한 사람 없음</p>}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}

          {result.remainders.length > 0 && (
            <section className="allocation-remainders">
              <h3>배분 단위보다 짧은 남은 시간</h3>
              <p className="muted small">아래 구간은 배분하지 않았습니다. 더 짧은 단위를 선택하면 포함할 수 있습니다.</p>
              <ul>{result.remainders.map((remainder) => <li key={remainder.date}>{dateLabel(remainder.date)} {remainder.start}–{remainder.end} ({durationLabel(remainder.minutes)})</li>)}</ul>
            </section>
          )}

          <section className="allocation-people">
            <h3>개인별 배분</h3>
            <p className="muted small">가능 시간대는 배분 단위 전체에 참여할 수 있는 횟수입니다. 가능한 시간이 다른 만큼 배분 횟수도 달라질 수 있습니다.</p>
            {result.people.length === 0 ? <p className="muted">아직 참가자 응답이 없습니다.</p> : (
              <table>
                <thead><tr><th scope="col">이름</th><th scope="col">배분 횟수</th><th scope="col">총 시간</th><th scope="col">가능 시간대</th></tr></thead>
                <tbody>{result.people.map((person) => <tr key={person.id}><th scope="row">{person.name}</th><td>{person.count}회</td><td>{durationLabel(person.minutes)}</td><td>{person.eligibleBlocks}개</td></tr>)}</tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
