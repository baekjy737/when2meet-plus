"use client";

import { useEffect, useState } from "react";
import Grid from "./Grid";
import SlotDetail from "./SlotDetail";
import { usePeople } from "./usePeople";
import type { PublicEvent, PublicParticipant } from "@/lib/types";

type Session = { participantId: string; token: string; name: string };

export default function EventView({ event, initialPeople }: { event: PublicEvent; initialPeople: PublicParticipant[] }) {
  const { people, setPeople, counts } = usePeople(event.id, initialPeople);
  const [session, setSession] = useState<Session | null>(null);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const key = `session:${event.id}`;

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(key) ?? "null") as Session | null;
      if (s) {
        setSession(s);
        setMine(new Set(initialPeople.find((p) => p.id === s.participantId)?.slots ?? []));
      }
    } catch {}
  }, [key, initialPeople]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setStatus("");
    const res = await fetch(`/api/events/${event.id}/participants`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, password }),
    });
    const data = await res.json();
    if (!res.ok) return setStatus(data.error);
    const s = { participantId: data.participantId, token: data.token, name: name.trim() };
    setSession(s);
    setMine(new Set(data.slots));
    try { localStorage.setItem(key, JSON.stringify(s)); } catch {}
    if (!people.some((p) => p.id === s.participantId)) setPeople([...people, { id: s.participantId, name: s.name, slots: [] }]);
  }

  async function save(next: Set<string>) {
    if (!session) return;
    setMine(next);
    setPeople((ps) => ps.map((p) => (p.id === session.participantId ? { ...p, slots: [...next] } : p)));
    setStatus("저장 중…");
    const res = await fetch(`/api/events/${event.id}/availability`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ participantId: session.participantId, token: session.token, slots: [...next] }),
    });
    if (res.status === 401) {
      setSession(null);
      try { localStorage.removeItem(key); } catch {}
      return setStatus("세션이 만료되었습니다. 다시 로그인하세요.");
    }
    setStatus(res.ok ? "저장됨" : "저장 실패");
  }

  function signOut() {
    setSession(null);
    setMine(new Set());
    try { localStorage.removeItem(key); } catch {}
  }

  return (
    <div className="event">
      <div className="event-head">
        <h1>{event.name}</h1>
        <p className="muted">응답 {people.length}명 · {event.timezone} 기준 · 링크를 공유해 가능한 시간을 받으세요</p>
      </div>
      <div className="panels">
        <section className="panel">
          {session ? (
            <>
              <div className="panel-head">
                <h2>{session.name}님의 가능한 시간</h2>
                <button className="link" onClick={signOut}>로그아웃</button>
              </div>
              <p className="muted">드래그해서 가능한 시간을 칠하세요. 자동 저장됩니다. <span className="status">{status}</span></p>
              <Grid event={event} selected={mine} onChange={save} />
            </>
          ) : (
            <form className="signin" onSubmit={signIn}>
              <h2>내 시간 입력하기</h2>
              <label className="field"><span>이름</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required /></label>
              <label className="field"><span>비밀번호 <small>(선택 · 이 이벤트에서만 사용)</small></span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
              {status && <p className="error">{status}</p>}
              <button className="primary">시작하기</button>
              <p className="muted">이미 응답했다면 같은 이름으로 다시 들어오면 수정할 수 있습니다.</p>
            </form>
          )}
        </section>
        <section className="panel">
          <h2>모두의 가능한 시간</h2>
          <Legend total={people.length} />
          <Grid event={event} counts={counts} total={people.length} onHover={setHover} />
          <SlotDetail slot={hover} people={people} slotMinutes={event.slotMinutes} />
        </section>
      </div>
    </div>
  );
}

export function Legend({ total }: { total: number }) {
  return (
    <div className="legend">
      <span>0/{total}</span>
      <span className="bar" />
      <span>{total}/{total}</span>
    </div>
  );
}
