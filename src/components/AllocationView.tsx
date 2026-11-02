"use client";

import { useId, useMemo, useState } from "react";
import { allocateTime, type AllocationBlock, type AllocationResult } from "@/lib/allocation";
import { exportAllocationCsv } from "@/lib/allocation-export";
import { dateLabel } from "@/lib/slots";
import type { PublicEvent, PublicParticipant } from "@/lib/types";

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

export function useAllocation(event: PublicEvent, people: PublicParticipant[]) {
  const resultId = useId();
  const [picked, setPicked] = useState<AllocationBlock | null>(null);
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

  function generate() {
    if (!valid) return;
    setError("");
    try {
      const result = allocateTime(event, people, { durationMin: duration, minPeople });
      setSnapshot({ result, sourceKey, durationMin: duration, minPeople });
      setPicked(null);
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

  return {
    duration, setDuration, minimum, setMinimum, validMinimum, valid, durations,
    snapshot, error, responsesChanged, optionsChanged, generate, download,
    picked, onPick: setPicked, resultId: `${resultId}-allocation-results`,
  };
}

type AllocationState = ReturnType<typeof useAllocation>;

/** Controls stay above the grid; all state is shared with the wide result table. */
export default function AllocationView({ allocation }: { allocation: AllocationState }) {
  const { duration, setDuration, minimum, setMinimum, validMinimum, valid, durations,
    snapshot, error, responsesChanged, optionsChanged, generate, resultId } = allocation;
  const result = snapshot?.result;
  const shortBlocks = result?.blocks.filter((block) => block.missing > 0).length ?? 0;
  const assignedPeople = result?.people.filter((person) => person.count > 0).length ?? 0;
  const helpId = `${resultId}-minimum-help`;

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
              onChange={(e) => setMinimum(e.target.value)} aria-invalid={!validMinimum} aria-describedby={helpId} />
          </label>
        </div>
        <p className={validMinimum ? "muted small" : "error small"} id={helpId}>
          {validMinimum ? "가능한 사람이 충분하면 최소 인원만큼 배분합니다. 부족한 시간대도 결과에 표시합니다." : "최소 인원은 1 이상의 정수로 입력해 주세요."}
        </p>
        <button type="submit" className="primary" disabled={!valid}>{snapshot ? "다시 계산" : "배분안 만들기"}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {(responsesChanged || optionsChanged) && (
        <div className="allocation-notice" role="status">
          <strong>{responsesChanged && optionsChanged ? "응답과 배분 조건이 바뀌었습니다." : responsesChanged ? "참가자 응답이 바뀌었습니다." : "배분 조건이 바뀌었습니다."}</strong>
          <p>아래 표와 CSV는 이전 배분안입니다. ‘다시 계산’을 누르면 최신 내용으로 갱신합니다.</p>
        </div>
      )}
      {result ? (
        <>
          <dl className="allocation-summary">
            <div><dt>전체 시간대</dt><dd>{result.blocks.length}개</dd></div>
            <div><dt>인원 충족</dt><dd>{result.blocks.length - shortBlocks}개</dd></div>
            <div><dt>인원 부족</dt><dd className={shortBlocks ? "error" : ""}>{shortBlocks}개</dd></div>
            <div><dt>배분된 사람</dt><dd>{assignedPeople}/{result.people.length}명</dd></div>
          </dl>
          <button type="button" className="results-jump" onClick={() => {
            const results = document.getElementById(resultId);
            results?.scrollIntoView({ block: "start" });
            results?.focus({ preventScroll: true });
          }}>아래 배분표 보기 ↓</button>
        </>
      ) : <p className="muted allocation-empty">조건을 정하고 배분안을 만들면 아래에 전체 결과가 표로 표시됩니다.</p>}
    </div>
  );
}

/** The same generated snapshot drives the table, counts, selection, and CSV. */
export function AllocationResults({ allocation }: { allocation: AllocationState }) {
  const { snapshot, responsesChanged, optionsChanged, download, picked, onPick, resultId } = allocation;
  if (!snapshot) return null;
  const result = snapshot.result;
  const headingId = `${resultId}-heading`;
  const helpId = `${resultId}-help`;

  return (
    <section className="card result-section allocation-result" id={resultId} aria-labelledby={headingId} tabIndex={-1}>
      <div className="result-section-head">
        <div>
          <h2 id={headingId}>TF 배분 결과</h2>
          <p className="muted small">{durationLabel(snapshot.durationMin)} 단위 · 시간대별 최소 {snapshot.minPeople}명 · 검토용 배분안</p>
        </div>
        <button type="button" onClick={download}>TF 배분 CSV</button>
      </div>
      {(responsesChanged || optionsChanged) && <p className="allocation-notice" role="status">이전 응답·조건으로 만든 배분안입니다. 위에서 다시 계산하면 최신 내용이 반영됩니다.</p>}
      {result.balanceLimited && <p className="allocation-notice" role="status">가능한 시간과 필요한 인원에 맞춰 배분했지만, 사람별 횟수를 충분히 고르게 조정하지 못했습니다. 개인별 결과를 확인해 주세요.</p>}
      <p className="muted small" id={helpId}>시간을 누르면 위 시간표에서 강조됩니다.</p>
      {result.blocks.length === 0 ? <p className="muted">현재 배분 단위로 나눌 수 있는 시간대가 없습니다.</p> : (
        <div className="results-table-wrap" role="region" aria-label="TF 시간순 배분표" aria-describedby={helpId}>
          <table className="results-table allocation-table">
            <colgroup><col className="result-date-col" /><col className="result-time-col" /><col /><col className="result-count-col" /><col className="result-count-col" /><col /></colgroup>
            <thead><tr><th scope="col">날짜</th><th scope="col">시간</th><th scope="col">배분된 사람</th><th scope="col">배분 / 필요</th><th scope="col">부족</th><th scope="col">대체 가능한 사람</th></tr></thead>
            <tbody>{result.blocks.map((block, index) => {
              const assignedIds = new Set(block.assigned.map((person) => person.id));
              const backups = block.eligible.filter((person) => !assignedIds.has(person.id));
              const on = picked?.id === block.id;
              const select = () => onPick(on ? null : block);
              const newDate = index === 0 || result.blocks[index - 1].date !== block.date;
              return (
                <tr key={block.id} className={`${on ? "on " : ""}${newDate ? "date-start " : ""}${block.missing ? "understaffed" : ""}`} onClick={(e) => {
                  if (!(e.target as HTMLElement).closest("button, details, a")) select();
                }}>
                  <td className="result-date" data-label="날짜"><time dateTime={block.date}>{dateLabel(block.date)}</time></td>
                  <th scope="row" data-label="시간"><button type="button" className="result-pick" aria-pressed={on}
                    aria-label={`${dateLabel(block.date)} ${block.start}–${block.end}, ${block.assigned.length}명 배분${block.missing ? `, ${block.missing}명 부족` : ""}, 시간표에서 보기`}
                    onClick={select}>{block.start}–{block.end}</button></th>
                  <td className="result-names" data-label="배분된 사람">{block.assigned.length ? block.assigned.map((person) => person.name).join(", ") : <span className="muted">없음</span>}</td>
                  <td className="result-number" data-label="배분 / 필요">{block.assigned.length} / {snapshot.minPeople}명</td>
                  <td className={`result-number ${block.missing ? "error" : "muted"}`} data-label="부족">{block.missing ? `${block.missing}명 부족` : "—"}</td>
                  <td className="result-names" data-label="대체 가능한 사람">{backups.length > 0 ? <details className="result-backups"><summary>{backups.length}명 보기</summary><p>{backups.map((person) => person.name).join(", ")}</p></details> : <span className="muted">없음</span>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      <div className={`allocation-secondary${result.remainders.length ? "" : " single"}`}>
        <section className="allocation-people">
          <h3>개인별 배분</h3>
          <p className="muted small">가능 시간대는 배분 단위 전체에 참여할 수 있는 횟수입니다. 가능한 시간이 다르면 배분 횟수도 달라질 수 있습니다.</p>
          {result.people.length === 0 ? <p className="muted">아직 참가자 응답이 없습니다.</p> : (
            <div className="results-table-wrap" role="region" aria-label="개인별 배분 집계">
              <table className="results-table compact-results-table">
                <thead><tr><th scope="col">이름</th><th scope="col">배분 횟수</th><th scope="col">총 시간</th><th scope="col">가능 시간대</th></tr></thead>
                <tbody>{result.people.map((person) => <tr key={person.id}><th scope="row">{person.name}</th><td>{person.count}회</td><td>{durationLabel(person.minutes)}</td><td>{person.eligibleBlocks}개</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
        {result.remainders.length > 0 && (
          <section className="allocation-remainders">
            <h3>배분 단위보다 짧은 남은 시간</h3>
            <p className="muted small">아래 구간은 배분하지 않았습니다. 더 짧은 단위를 선택하면 포함할 수 있습니다.</p>
            <div className="results-table-wrap" role="region" aria-label="배분하지 않은 잔여 구간">
              <table className="results-table compact-results-table">
                <thead><tr><th scope="col">날짜</th><th scope="col">남은 시간</th><th scope="col">길이</th></tr></thead>
                <tbody>{result.remainders.map((remainder) => <tr key={remainder.date}><th scope="row">{dateLabel(remainder.date)}</th><td>{remainder.start}–{remainder.end}</td><td>{durationLabel(remainder.minutes)}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
