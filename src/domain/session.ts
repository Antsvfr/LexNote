import type { CourseSession, Module, Subject } from './types';
import { typeLabel, type SessionType } from './sessionType';
import { newId } from '@/lib/ids';

const nowISO = () => new Date().toISOString();

export interface SubjectInput {
  name: string;
  color: string;
  icon?: string;
  term?: string;
  teacher?: string;
  description?: string;
}

const clean = (v?: string) => { const t = v?.trim(); return t ? t : undefined; };

export function createSubject(userId: string, input: SubjectInput): Subject {
  const t = nowISO();
  return {
    id: newId(), userId, name: input.name.trim(), color: input.color, icon: clean(input.icon), term: clean(input.term),
    teacher: clean(input.teacher), description: clean(input.description), createdAt: t, updatedAt: t,
  };
}

export function createModule(userId: string, subjectId: string, name: string): Module {
  const t = nowISO();
  return { id: newId(), userId, subjectId, name: name.trim(), createdAt: t, updatedAt: t };
}

export interface SessionInput {
  subjectId: string;
  moduleId?: string | null;
  type: SessionType;
  title: string;
  number: number | null;
  date: string;
  startTime?: string;
  endTime?: string;
  teacher?: string;
  room?: string;
}

export function createSession(userId: string, input: SessionInput): CourseSession {
  const t = nowISO();
  return {
    id: newId(),
    userId,
    subjectId: input.subjectId,
    moduleId: input.moduleId ?? null,
    type: input.type,
    number: input.number,
    title: input.title.trim(),
    date: input.date,
    startTime: clean(input.startTime),
    endTime: clean(input.endTime),
    teacher: clean(input.teacher),
    room: clean(input.room),
    durationSec: 0,
    status: 'in_progress',
    completedAt: null,
    wordCount: 0,
    excerpt: '',
    searchText: '',
    createdAt: t,
    updatedAt: t,
    // Emplacements futurs — vides tant que les fonctionnalités n'existent pas.
    transcript: null,
    audio: null,
    documents: [],
    aiOutputs: {},
    legalItems: [],
    flashcards: [],
    questions: [],
    aiMeta: null,
  };
}

/** « CM 03 — Conditions de validité », « TD 01 — Cas pratique » */
export function sessionLabel(s: Pick<CourseSession, 'type' | 'number' | 'title'>): string {
  const head = `${typeLabel(s.type)}${s.number != null ? ` ${String(s.number).padStart(2, '0')}` : ''}`;
  const t = s.title.trim();
  return t ? `${head} — ${t}` : head;
}

/** Prochain numéro pour ce type dans cette matière (CM 04 si CM 01-03 existent ; TD repart à 01). */
export function nextSessionNumber(sessions: Pick<CourseSession, 'subjectId' | 'type' | 'number'>[], subjectId: string, type: SessionType): number {
  const nums = sessions.filter((s) => s.subjectId === subjectId && s.type === type).map((s) => s.number ?? 0);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}

/** « 04 — Vices du consentement » (le type est affiché à part, par un badge). */
export function sessionNumberTitle(s: Pick<CourseSession, 'number' | 'title'>): string {
  const n = s.number != null ? String(s.number).padStart(2, '0') : '';
  const t = s.title.trim();
  return n && t ? `${n} — ${t}` : n || t || 'Sans titre';
}
