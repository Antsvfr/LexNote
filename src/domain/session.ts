import type { CourseSession, Module, Subject } from './types';
import { newId } from '@/lib/ids';

const nowISO = () => new Date().toISOString();

export function createSubject(name: string, color: string): Subject {
  const t = nowISO();
  return { id: newId('sub'), name: name.trim(), color, createdAt: t, updatedAt: t };
}

export function createModule(subjectId: string, name: string): Module {
  const t = nowISO();
  return { id: newId('mod'), subjectId, name: name.trim(), createdAt: t, updatedAt: t };
}

export function createSession(input: {
  subjectId: string;
  moduleId: string;
  title: string;
  number: number | null;
  date: string;
}): CourseSession {
  const t = nowISO();
  return {
    id: newId('cm'),
    subjectId: input.subjectId,
    moduleId: input.moduleId,
    number: input.number,
    title: input.title.trim(),
    date: input.date,
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

/** "CM 03 — Conditions de validité" */
export function sessionLabel(s: Pick<CourseSession, 'number' | 'title'>): string {
  const n = s.number != null ? `CM ${String(s.number).padStart(2, '0')}` : '';
  const t = s.title.trim();
  if (n && t) return `${n} — ${t}`;
  return n || t || 'CM sans titre';
}

export function nextSessionNumber(sessions: CourseSession[], moduleId: string): number {
  const nums = sessions.filter((s) => s.moduleId === moduleId).map((s) => s.number ?? 0);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}
