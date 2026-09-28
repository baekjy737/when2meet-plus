"use client";

import { useEffect, useMemo, useState } from "react";
import { bestBlocks, type Block } from "@/lib/analysis";
import { dateLabel, parseSlot, slotId } from "@/lib/slots";
import type { PublicEvent, PublicParticipant } from "@/lib/types";
import { Legend } from "./EventView";
import Grid from "./Grid";
import SlotDetail from "./SlotDetail";
import { usePeople } from "./usePeople";

type KeyState = "checking" | "ok" | "missing" | "invalid";

export default function AdminView({ event, initialPeople }: { event: PublicEvent; initialPeople: PublicParticipant[] }) {
  const { people, counts } = usePeople(event.id, initialPeople);
  const [adminKey, setAdminKey] = useState("");
  const [keyState, setKeyState] = useState<KeyState>("checking");
  const [origin, setOrigin] = useState("");
  const [duration, setDuration] = useState(Math.max(event.slotMinutes, 60));
  const [minPeople, setMinPeople] = useState(1);
  const [required, setRequired] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Block | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    setOrigin(location.origin);
    const fromHash = new URLSearchParams(location.hash.slice(1)).get("key");
    let stored: string | null = null;
    try { stored = localStorage.getItem(`admin:${event.id}`); } catch {}
    const k = fromHash ?? stored;
    if (!k) return setKeyState("missing");
    fetch(`/api/events/${event.id}/export?format=json&limit=1`, { headers: { authorization: `Bearer ${k}` } }).then((r) => {
      if (!r.ok) return setKeyState("invalid");
      setAdminKey(k);
      setKeyState("ok");
      try { localStorage.setItem(`admin:${event.id}`, k); } catch {}
    });
  }, [event.id]);

  const blocks = useMemo(
    () => bestBlocks(event, people, { durationMin: duration, minPeople, required: [...required], limit: 20 }),
    [event, people, duration, minPeople, required],
  );

  const highlight = useMemo(() => {
    if (!picked) return undefined;
    const { min: start } = parseSlot(`${picked.date}T${picked.start}`);
    const s = new Set<string>();
    for (let m = start; m < start + picked.minutes; m += event.slotMinutes) s.add(slotId(picked.date, m));
    return s;
  }, [picked, event]);

  if (keyState === "checking") return <p className="muted">관리자 키 확인 중…</p>;
  if (keyState !== "ok") {
    return (
      <div className="card">
        <h1>관리자 권한이 필요합니다</h1>
        <p className="muted">{keyState === "invalid" ? "관리자 키가 올바르지 않습니다." : "이벤트를 만들 때 받은 관리자 링크로 접속하세요."}</p>
        <a href={`/e/${event.id}`}>참가자 페이지로 이동 →</a>
      </div>
    );
  }

  const publicUrl = `${origin}/e/${event.id}`;
  const adminUrl = `${origin}/e/${event.id}/admin#key=${adminKey}`;
  const exportQuery = `duration=${duration}&minPeople=${minPeople}`;

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 1500);
  };

  async function download(format: "xlsx" | "csv" | "json") {
    const res = await fetch(`/api/events/${event.id}/export?format=${format}&${exportQuery}`, {
      headers: { authorization: `Bearer ${adminKey}` },
    });
    if (!res.ok) return alert("내보내기 실패");
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: `${event.name}-${event.id}.${format}` });
    a.click();
    URL.revokeObjectURL(url);
  }

  const durations = [1, 2, 3, 4, 6, 8].map((n) => n * event.slotMinutes).filter((m) => m <= event.endMin - event.startMin && m <= 240);

  return (
    <div className="event">
      <div className="event-head">
        <h1>{event.name} <span className="badge">관리자</span></h1>
        <p className="muted">응답 {people.length}명 · {event.timezone} 기준</p>
      </div>

      <section className="card links">
        <div className="link-row">
          <span>참가자 링크</span>
          <code>{publicUrl}</code>
          <button onClick={() => copy("public", publicUrl)}>{copied === "public" ? "복사됨" : "복사"}</button>
        </div>
        <div className="link-row">
          <span>관리자 링크</span>
          <code className="secret">{adminUrl}</code>
          <button onClick={() => copy("admin", adminUrl)}>{copied === "admin" ? "복사됨" : "복사"}</button>
        </div>
        <p className="muted small">관리자 링크는 이 이벤트의 데이터 내보내기 권한입니다. 공유하지 말고 안전한 곳에 보관하세요.</p>
      </section>

      <div className="panels">
        <section className="panel">
          <h2>최적 시간</h2>
          <div className="filters">
            <label className="field">
              <span>회의 길이</span>
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {durations.map((m) => <option key={m} value={m}>{m >= 60 ? `${m / 60}시간` : `${m}분`}</option>)}
              </select>
            </label>
            <label className="field">
              <span>최소 인원</span>
              <input type="number" min={1} max={Math.max(1, people.length)} value={minPeople} onChange={(e) => setMinPeople(Math.max(1, Number(e.target.value)))} />
            </label>
          </div>
          {people.length > 0 && (
            <div className="required">
              <span className="muted small">꼭 참석해야 하는 사람</span>
              <div className="chips">
                {people.map((p) => (
                  <button
                    key={p.id} type="button"
                    className={`chip ${required.has(p.name) ? "on" : ""}`}
                    onClick={() => setRequired((r) => { const n = new Set(r); n.has(p.name) ? n.delete(p.name) : n.add(p.name); return n; })}
                  >{p.name}</button>
                ))}
              </div>
            </div>
          )}
          {blocks.length === 0 ? (
            <p className="muted">조건에 맞는 시간이 없습니다.</p>
          ) : (
            <ol className="best">
              {blocks.map((b) => {
                const on = picked?.date === b.date && picked.start === b.start;
                return (
                  <li key={b.date + b.start} className={on ? "on" : ""} onClick={() => setPicked(on ? null : b)}>
                    <div className="when">{dateLabel(b.date)} {b.start}–{b.end}</div>
                    <div className="count">{b.available.length}/{people.length}명</div>
                    {b.unavailable.length > 0 && <div className="muted small">불가: {b.unavailable.join(", ")}</div>}
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="panel">
          <h2>모두의 가능한 시간</h2>
          <Legend total={people.length} />
          <Grid event={event} counts={counts} total={people.length} highlight={highlight} onHover={setHover} />
          <SlotDetail slot={hover} people={people} slotMinutes={event.slotMinutes} />
        </section>
      </div>

      <section className="card">
        <h2>데이터 내보내기</h2>
        <p className="muted">현재 필터(회의 길이·최소 인원)가 최적 시간 순위에 반영됩니다.</p>
        <div className="exports">
          <button className="primary" onClick={() => download("xlsx")}>엑셀 (.xlsx)</button>
          <button onClick={() => download("csv")}>CSV</button>
          <button onClick={() => download("json")}>JSON</button>
        </div>
        <details>
          <summary>API로 가져오기</summary>
          <p className="muted small">관리자 키를 Bearer 토큰으로 사용합니다. format은 json · csv · xlsx 중 하나입니다.</p>
          <pre>{`curl -H "Authorization: Bearer ${adminKey}" \\
  "${origin}/api/events/${event.id}/export?format=json&${exportQuery}"`}</pre>
        </details>
      </section>
    </div>
  );
}
