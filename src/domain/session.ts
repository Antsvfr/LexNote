import type { CourseSession, Module, SessionType, Subject } from './types';
import { newId } from '@/lib/ids';

const nowISO = () => new Date().toISOString();

export function createSubject(name: string, color: string): Subject {
  const t = nowISO();
  return { id: newId(), name: name.trim(), color, createdAt: t, updatedAt: t };
}

export function createModule(subjectId: string, name: string): Module {
  const t = nowISO();
  return { id: newId(), subjectId, name: name.trim(), createdAt: t, updatedAt: t };
}

export function createSession(input: {
  subjectId: string;
  moduleId?: string;
  type: SessionType;
  title: string;
  number: number | null;
  date: string;
  startTime?: string;
  endTime?: string;
  teacher?: string;
  room?: string;
}): CourseSession {
  const t = nowISO();
  return {
    id: newId(),
    subjectId: input.subjectId,
    moduleId: input.moduleId ?? '',
    type: input.type,
    number: input.number,
    title: input.title.trim(),
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    teacher: input.teacher,
    room: input.room,
    durationSec: 0,
    status: 'in_progress',
    completedAt: null,
    wordCount: 0,
    excerpt: '',
    searchText: '',
    createdAt: t,
    updatedAt: t,
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

const TYPE_LABELS: Record<SessionType, string> = {
  CM: 'CM',
  TD: 'TD',
  TP: 'TP',
  COURSE: 'Cours',
  SEMINAR: 'Séminaire',
  WORKSHOP: 'Atelier',
  REVISION: 'Révision',
  OTHER: 'Séance',
};

export function sessionLabel(s: Pick<CourseSession, 'number' | 'title' | 'type'>): string {
  const kind = TYPE_LABELS[s.type];
  const n = s.number != null && ['CM', 'TD', 'TP'].includes(s.type) ? kind + ' ' + String(s.number).padStart(2, '0') : '';
  const t = s.title.trim();
  if (n && t) return n + ' — ' + t;
  return n || t || kind + ' sans titre';
}

export function nextSessionNumber(sessions: CourseSession[], moduleId: string | undefined, type: SessionType): number {
  const nums = sessions
    .filter((s) => s.moduleId === (moduleId ?? '') && s.type === type)
    .map((s) => s.number ?? 0);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}

export const SESSION_TYPE_OPTIONS: { id: SessionType; label: string }[] = [
  { id: 'CM', label: 'CM' },
  { id: 'TD', label: 'TD' },
  { id: 'TP', label: 'TP' },
  { id: 'COURSE', label: 'Cours' },
  { id: 'SEMINAR', label: 'Séminaire' },
  { id: 'WORKSHOP', label: 'Atelier' },
  { id: 'REVISION', label: 'Révision' },
  { id: 'OTHER', label: 'Autre' },
];
