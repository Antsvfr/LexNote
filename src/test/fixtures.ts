import { createModule, createSession, createSubject, type SessionInput } from '@/domain/session';
import type { CourseSession, Subject } from '@/domain/types';

/** Identifiants de test uniquement — aucune donnée de démonstration n'existe dans l'application. */
export const U = 'user-test';
export const subj = (name = 'Droit', color = 'indigo'): Subject => createSubject(U, { name, color });
export const mod = (subjectId: string, name = 'Contrats') => createModule(U, subjectId, name);
export const sess = (over: Partial<SessionInput> & { subjectId?: string } = {}): CourseSession =>
  createSession(U, { subjectId: 'sub', moduleId: null, type: 'CM', title: 'x', number: 1, date: '2025-01-01', ...over });
