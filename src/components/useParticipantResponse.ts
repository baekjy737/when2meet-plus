"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { PublicParticipant } from "@/lib/types";

type Session = { participantId: string; token: string; name: string };
type OwnResponse = { slots: string[]; revision: number; name: string };
type Issue = "conflict" | "network" | null;

export function useParticipantResponse(eventId: string, setPeople: Dispatch<SetStateAction<PublicParticipant[]>>) {
  const [linkEntry, setLinkEntry] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [restoring, setRestoring] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [issue, setIssue] = useState<Issue>(null);
  const [privateLink, setPrivateLink] = useState("");
  const sessionRef = useRef<Session | null>(null);
  const version = useRef(0);
  const generation = useRef(0);
  const sequence = useRef(0);
  const blocked = useRef(false);
  const interactionLocked = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const key = `session:${eventId}`;
  const base = `/api/events/${eventId}`;

  function updatePerson(s: Session, slots: string[], revision: number) {
    setPeople((ps) => {
      const person = { id: s.participantId, name: s.name, slots, revision };
      return ps.some((p) => p.id === s.participantId) ? ps.map((p) => p.id === s.participantId ? person : p) : [...ps, person];
    });
  }

  function activate(s: Session, data: OwnResponse) {
    generation.current++;
    blocked.current = false;
    version.current = data.revision;
    sessionRef.current = s;
    setSession(s);
    setMine(new Set(data.slots));
    setIssue(null);
    setSaving(false);
    setPrivateLink("");
    setStatus("저장된 응답을 불러왔습니다.");
    updatePerson(s, data.slots, data.revision);
    try { localStorage.setItem(key, JSON.stringify(s)); } catch {}
  }

  function clearSession(message = "") {
    generation.current++;
    sessionRef.current = null;
    blocked.current = false;
    setSession(null);
    setMine(new Set());
    setPrivateLink("");
    setIssue(null);
    setSaving(false);
    setStatus(message);
    try { localStorage.removeItem(key); } catch {}
  }

  async function ownResponse(s: Session) {
    const res = await fetch(`${base}/availability?participantId=${encodeURIComponent(s.participantId)}`, {
      headers: { authorization: `Bearer ${s.token}` }, cache: "no-store",
    });
    const data = await res.json();
    return { res, data };
  }

  useEffect(() => {
    const onHashChange = () => {
      const params = new URLSearchParams(location.hash.slice(1));
      if (params.has("participant") && params.has("edit")) setLinkEntry((value) => value + 1);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    let active = true;
    setRestoring(true);
    const params = new URLSearchParams(location.hash.slice(1));
    const participantId = params.get("participant");
    const editKey = params.get("edit");
    let stored: Session | null = null;
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? "null");
      if (value && typeof value.participantId === "string" && typeof value.token === "string" && typeof value.name === "string") stored = value;
    } catch {}
    void (async () => {
      try {
        if (participantId && editKey) {
          const res = await fetch(`${base}/participants`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId, editKey }) });
          const data = await res.json();
          if (!active) return;
          // A consumed or invalid link must not trap a valid local session on refresh.
          history.replaceState(history.state, "", location.pathname + location.search);
          if (res.ok) {
            activate({ participantId: data.participantId, token: data.token, name: data.name }, data);
            return;
          }
          const linkError = data.error || "수정 링크를 확인해 주세요.";
          if (stored) {
            const previous = await ownResponse(stored);
            if (!active) return;
            if (previous.res.ok) { activate({ ...stored, name: previous.data.name }, previous.data); setStatus(`${linkError} 이 기기의 기존 응답을 불러왔습니다.`); return; }
            if (previous.res.status === 401 || previous.res.status === 404) clearSession();
          }
          setStatus(linkError);
        } else if (stored) {
          const { res, data } = await ownResponse(stored);
          if (!active) return;
          if (res.ok) activate({ ...stored, name: data.name }, data);
          else if (res.status === 401 || res.status === 404) clearSession("수정 권한이 만료되었거나 응답이 삭제되었습니다. 비밀번호 또는 개인 수정 링크로 다시 접속해 주세요.");
          else setStatus(data.error || "응답을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
        }
      } catch {
        if (active) setStatus("연결을 확인한 뒤 새로고침해 주세요. 이 기기에 저장된 접속 정보는 유지됩니다.");
      } finally {
        if (active) setRestoring(false);
      }
    })();
    return () => { active = false; generation.current++; };
    // Restore once per event, never replace local edits on public polling updates.
  }, [eventId, linkEntry]); // eslint-disable-line react-hooks/exhaustive-deps

  async function signIn(name: string, password: string) {
    if (busy) return;
    interactionLocked.current = true;
    setBusy(true);
    setStatus("");
    try {
      const res = await fetch(`${base}/participants`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, password }) });
      const data = await res.json();
      if (!res.ok) return setStatus(data.error || "접속하지 못했습니다.");
      activate({ participantId: data.participantId, token: data.token, name: data.name }, data);
    } catch { setStatus("연결을 확인한 뒤 다시 시도해 주세요."); }
    finally { interactionLocked.current = false; setBusy(false); }
  }

  function save(next: Set<string>, retry = false) {
    const s = sessionRef.current;
    if (!s || interactionLocked.current) return;
    const slots = [...next];
    setMine(new Set(next));
    if (blocked.current && !retry) return;
    if (retry) { blocked.current = false; setIssue(null); }
    const currentGeneration = generation.current;
    const currentSequence = ++sequence.current;
    setSaving(true);
    setStatus("저장 중…");
    updatePerson(s, slots, version.current);
    queue.current = queue.current.then(async () => {
      if (currentGeneration !== generation.current || blocked.current) return;
      try {
        const res = await fetch(`${base}/availability`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ participantId: s.participantId, token: s.token, slots, revision: version.current }),
        });
        const data = await res.json();
        if (currentGeneration !== generation.current) return;
        if (res.status === 401 || res.status === 404) {
          clearSession("수정 권한이 만료되었거나 응답이 삭제되었습니다. 다시 접속해 주세요.");
          return;
        }
        if (res.status === 409 || res.status === 428) {
          blocked.current = true;
          generation.current++;
          setIssue("conflict");
          setSaving(false);
          setStatus("다른 기기에서 응답이 변경되었습니다. 현재 선택은 아직 저장되지 않았습니다.");
          if (Array.isArray(data.slots)) updatePerson(s, data.slots, data.revision);
          return;
        }
        if (!res.ok) throw new Error(data.error || "저장 실패");
        version.current = data.revision;
        if (currentSequence === sequence.current) {
          setStatus("저장됨");
          setSaving(false);
          updatePerson(s, data.slots, data.revision);
        }
      } catch {
        if (currentGeneration !== generation.current) return;
        blocked.current = true;
        generation.current++;
        setIssue("network");
        setSaving(false);
        setStatus("저장하지 못했습니다. 연결을 확인한 뒤 다시 저장해 주세요.");
      }
    });
  }

  async function reload() {
    const s = sessionRef.current;
    if (!s || busy || !confirm("아직 저장하지 못한 선택을 버리고 최신 응답을 불러올까요?")) return;
    interactionLocked.current = true;
    setBusy(true);
    try {
      const { res, data } = await ownResponse(s);
      if (!res.ok) {
        if (res.status === 401 || res.status === 404) clearSession("응답이 삭제되었거나 수정 권한이 만료되었습니다.");
        else setStatus(data.error || "응답을 불러오지 못했습니다.");
        return;
      }
      activate(s, data);
    } catch { setStatus("연결을 확인한 뒤 다시 시도해 주세요."); }
    finally { interactionLocked.current = false; setBusy(false); }
  }

  async function createLink() {
    const s = sessionRef.current;
    if (!s || busy) return;
    if (privateLink && !confirm("개인 수정 링크를 새로 발급할까요? 이전 수정 링크는 사용할 수 없게 됩니다.")) return;
    interactionLocked.current = true;
    setBusy(true);
    try {
      const res = await fetch(`${base}/participants/${s.participantId}/edit-link`, { method: "POST", headers: { authorization: `Bearer ${s.token}` } });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401 || res.status === 404) clearSession("수정 권한이 만료되었거나 응답이 삭제되었습니다. 다시 접속해 주세요.");
        else setStatus(data.error || "수정 링크를 만들지 못했습니다.");
        return;
      }
      const params = new URLSearchParams({ participant: s.participantId, edit: data.editKey });
      setPrivateLink(`${location.origin}/e/${eventId}#${params}`);
    } catch { setStatus("연결을 확인한 뒤 다시 시도해 주세요."); }
    finally { interactionLocked.current = false; setBusy(false); }
  }

  async function withdraw() {
    const s = sessionRef.current;
    if (!s || busy || saving || !confirm(`${s.name}님의 참여를 취소할까요? 모든 응답이 삭제되고 참가자 집계에서 빠집니다. 되돌릴 수 없습니다.`)) return;
    interactionLocked.current = true;
    setBusy(true);
    try {
      const res = await fetch(`${base}/participants/${s.participantId}`, { method: "DELETE", headers: { authorization: `Bearer ${s.token}` } });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401 || res.status === 404) clearSession("수정 권한이 만료되었거나 응답이 삭제되었습니다. 다시 접속해 주세요.");
        else setStatus(data.error || "참여를 취소하지 못했습니다.");
        return;
      }
      setPeople((ps) => ps.filter((p) => p.id !== s.participantId));
      clearSession("참여가 취소되었습니다.");
    } catch { setStatus("연결을 확인한 뒤 다시 시도해 주세요."); }
    finally { interactionLocked.current = false; setBusy(false); }
  }

  function signOut() {
    if (saving || !confirm("이 기기에서 로그아웃할까요? 다시 수정하려면 비밀번호 또는 개인 수정 링크가 필요합니다.")) return;
    clearSession();
  }

  return { session, mine, restoring, busy, saving, status, issue, privateLink, signIn, save, reload, createLink, withdraw, signOut };
}
