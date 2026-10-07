import { IndexedDbAdapter } from '@/services/storage/indexedDbAdapter';
import type { StorageAdapter } from '@/services/storage/types';
import type { CourseSession, Module, NoteDocument, Subject } from '@/domain/types';
import { newId } from '@/lib/ids';

type LegacySubject = Subject & { isDemo?: boolean };
type LegacyModule = Module & { isDemo?: boolean };
type LegacySession = CourseSession & { isDemo?: boolean };

export interface LegacyImportPreview {
  subjects: number;
  modules: number;
  sessions: number;
  notes: number;
}

const marker = (userId: string) => 'account-migration:' + userId;

async function legacySelection(userId: string) {
  const legacy = await IndexedDbAdapter.open('lexnote');
  if (await legacy.getMeta<boolean>(marker(userId))) return null;
  const bundle = await legacy.exportAll();

  const sessions = (bundle.sessions as LegacySession[]).filter((s) => s.isDemo !== true);
  const wantedSessionIds = new Set(sessions.map((s) => s.id));
  const notes = bundle.notes.filter((n) => wantedSessionIds.has(n.sessionId));

  const wantedModuleIds = new Set(sessions.map((s) => s.moduleId).filter(Boolean));
  const modules = (bundle.modules as LegacyModule[]).filter((m) => m.isDemo !== true || wantedModuleIds.has(m.id));

  const wantedSubjectIds = new Set<string>([
    ...sessions.map((s) => s.subjectId),
    ...modules.map((m) => m.subjectId),
  ]);
  const subjects = (bundle.subjects as LegacySubject[]).filter((s) => s.isDemo !== true || wantedSubjectIds.has(s.id));

  return { legacy, subjects, modules, sessions, notes };
}

export async function getLegacyImportPreview(userId: string): Promise<LegacyImportPreview | null> {
  const found = await legacySelection(userId);
  if (!found || found.sessions.length === 0) return null;
  return {
    subjects: found.subjects.length,
    modules: found.modules.length,
    sessions: found.sessions.length,
    notes: found.notes.length,
  };
}

export async function ignoreLegacyData(userId: string): Promise<void> {
  const legacy = await IndexedDbAdapter.open('lexnote');
  await legacy.setMeta(marker(userId), true);
}

export async function importLegacyData(userId: string, target: StorageAdapter): Promise<LegacyImportPreview> {
  const found = await legacySelection(userId);
  if (!found) return { subjects: 0, modules: 0, sessions: 0, notes: 0 };

  const subjectMap = new Map(found.subjects.map((s) => [s.id, newId()]));
  const moduleMap = new Map(found.modules.map((m) => [m.id, newId()]));
  const sessionMap = new Map(found.sessions.map((s) => [s.id, newId()]));

  const subjects: Subject[] = found.subjects.map((old) => {
    const { isDemo: _ignored, ...s } = old;
    return { ...s, id: subjectMap.get(old.id)!, updatedAt: new Date().toISOString() };
  });
  const modules: Module[] = found.modules.map((old) => {
    const { isDemo: _ignored, ...m } = old;
    return {
      ...m,
      id: moduleMap.get(old.id)!,
      subjectId: subjectMap.get(old.subjectId) ?? old.subjectId,
      updatedAt: new Date().toISOString(),
    };
  });
  const sessions: CourseSession[] = found.sessions.map((old) => {
    const { isDemo: _ignored, ...s } = old;
    return {
      ...s,
      id: sessionMap.get(old.id)!,
      subjectId: subjectMap.get(old.subjectId) ?? old.subjectId,
      moduleId: old.moduleId ? (moduleMap.get(old.moduleId) ?? '') : '',
      type: old.type ?? 'CM',
      updatedAt: new Date().toISOString(),
    };
  });
  const notes: NoteDocument[] = found.notes
    .map((n) => ({
      ...n,
      sessionId: sessionMap.get(n.sessionId) ?? '',
      updatedAt: new Date().toISOString(),
    }))
    .filter((n) => Boolean(n.sessionId));

  await target.commit({ putSubjects: subjects, putModules: modules, putSessions: sessions, putNotes: notes });
  await found.legacy.setMeta(marker(userId), true);

  return { subjects: subjects.length, modules: modules.length, sessions: sessions.length, notes: notes.length };
}
