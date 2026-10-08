/**
 * Données créées AVANT l'introduction des comptes (bases IndexedDB `lexnote` et `lexnote-capture`).
 *
 * Règles (sécurité des données) :
 *  - rien n'est jamais attribué automatiquement à un compte : l'import est explicite ;
 *  - si ces bases ne contiennent QUE l'ancienne démonstration (ou rien), elles sont supprimées en silence ;
 *  - après un import réussi, les anciennes bases sont supprimées (impossible de les importer deux fois).
 */
import { openDB } from 'idb';
import { newId } from '@/lib/ids';
import type { AudioChunk, AudioSession, Interruption, NoteAnchor, TimelineMarker, TranscriptSegment } from '@/domain/capture';
import type { CourseSession, Module, NoteDocument, Subject } from '@/domain/types';
import type { StorageAdapter } from '@/services/storage/types';
import type { CaptureStorage } from '@/services/capture/storage/types';

const LEGACY_DB = 'lexnote';
const LEGACY_CAPTURE = 'lexnote-capture';

export interface LegacySummary { subjects: number; modules: number; sessions: number }

type Rec = { id: string; isDemo?: boolean } & Record<string, unknown>;

async function dbExists(name: string): Promise<boolean> {
  const list = (indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> }).databases;
  if (!list) return false;
  return (await list.call(indexedDB)).some((d) => d.name === name);
}

async function readAll<T>(dbName: string, store: string): Promise<T[]> {
  const db = await openDB(dbName);
  try { return db.objectStoreNames.contains(store) ? ((await db.getAll(store)) as T[]) : []; } finally { db.close(); }
}

async function deleteDb(name: string) {
  await new Promise<void>((res) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = r.onerror = r.onblocked = () => res(); });
}

export async function detectLegacy(): Promise<LegacySummary | null> {
  try {
    if (!(await dbExists(LEGACY_DB))) { if (await dbExists(LEGACY_CAPTURE)) await deleteDb(LEGACY_CAPTURE); return null; }
    const [subjects, modules, sessions] = await Promise.all(['subjects', 'modules', 'sessions'].map((s) => readAll<Rec>(LEGACY_DB, s)));
    const real = (l: Rec[]) => l.filter((x) => !x.isDemo);
    const summary = { subjects: real(subjects!).length, modules: real(modules!).length, sessions: real(sessions!).length };
    if (!summary.subjects && !summary.modules && !summary.sessions) {
      // Uniquement l'ancienne démonstration (ou une base vide) : on la supprime.
      await deleteDb(LEGACY_DB); await deleteDb(LEGACY_CAPTURE);
      return null;
    }
    return summary;
  } catch (e) {
    console.warn('[LexNote] détection des anciennes données impossible', e);
    return null;
  }
}

export async function importLegacy(userId: string, local: StorageAdapter, capture: CaptureStorage | null): Promise<LegacySummary> {
  const [subjects, modules, sessions, notes] = await Promise.all([
    readAll<Subject & Rec>(LEGACY_DB, 'subjects'), readAll<Module & Rec>(LEGACY_DB, 'modules'),
    readAll<CourseSession & Rec>(LEGACY_DB, 'sessions'), readAll<NoteDocument>(LEGACY_DB, 'notes'),
  ]);
  const keepS = subjects.filter((x) => !x.isDemo), keepM = modules.filter((x) => !x.isDemo), keepC = sessions.filter((x) => !x.isDemo);
  const sMap = new Map(keepS.map((x) => [x.id, newId()]));
  const mMap = new Map(keepM.map((x) => [x.id, newId()]));
  const cMap = new Map(keepC.map((x) => [x.id, newId()]));
  const clean = <T extends object>(x: T): T => { const c = { ...(x as Record<string, unknown>) }; delete c.isDemo; delete c.dirty; delete c.version; return c as T; };

  const putSubjects = keepS.map((x) => ({ ...clean(x), id: sMap.get(x.id)!, userId }));
  const putModules = keepM.filter((x) => sMap.has(x.subjectId)).map((x) => ({ ...clean(x), id: mMap.get(x.id)!, userId, subjectId: sMap.get(x.subjectId)! }));
  const putSessions = keepC.filter((x) => sMap.has(x.subjectId)).map((x) => ({
    ...clean(x), id: cMap.get(x.id)!, userId, subjectId: sMap.get(x.subjectId)!,
    moduleId: x.moduleId && mMap.has(x.moduleId) ? mMap.get(x.moduleId)! : null,
    type: ((x as { type?: CourseSession['type'] }).type ?? 'CM') as CourseSession['type'],
  }));
  const putNotes = notes.filter((n) => cMap.has(n.sessionId)).map((n) => ({ ...n, sessionId: cMap.get(n.sessionId)! }));
  await local.commit({ putSubjects, putModules, putSessions, putNotes });

  if (capture) {
    const rd = <T,>(s: string) => readAll<T>(LEGACY_CAPTURE, s).catch(() => [] as T[]);
    const [audio, segs, markers, anchors, ints, chunks, chunkData] = await Promise.all([
      rd<AudioSession>('audioSessions'), rd<TranscriptSegment>('segments'), rd<TimelineMarker>('markers'), rd<NoteAnchor>('anchors'),
      rd<Interruption>('interruptions'), rd<AudioChunk>('chunks'), rd<{ id: string; mimeType: string; data: ArrayBuffer }>('chunkData'),
    ]);
    const sid = (id: string) => cMap.get(id);
    const segMap = new Map(segs.filter((x) => sid(x.sessionId)).map((x) => [x.id, newId()]));
    for (const a of audio) { const s = sid(a.sessionId); if (s) await capture.putAudioSession({ ...a, id: s, sessionId: s, userId }); }
    await capture.putSegments(segs.filter((x) => sid(x.sessionId)).map((x) => ({ ...x, id: segMap.get(x.id)!, sessionId: sid(x.sessionId)!, userId })));
    for (const m of markers) { const s = sid(m.sessionId); if (s) await capture.putMarker({ ...m, id: newId(), sessionId: s, userId }); }
    await capture.putAnchors(anchors.filter((x) => sid(x.sessionId)).map((x) => ({ ...x, id: newId(), sessionId: sid(x.sessionId)!, userId, nearbyTranscriptSegmentIds: x.nearbyTranscriptSegmentIds.map((i) => segMap.get(i)).filter(Boolean) as string[] })));
    for (const i of ints) { const s = sid(i.sessionId); if (s) await capture.putInterruption({ ...i, id: newId(), sessionId: s, userId }); }
    const data = new Map(chunkData.map((d) => [d.id, d]));
    for (const c of chunks) {
      const s = sid(c.sessionId), d = data.get(c.id);
      if (s && d) await capture.putChunk({ ...c, id: newId(), sessionId: s }, new Blob([d.data], { type: d.mimeType }));
    }
  }
  await deleteDb(LEGACY_DB);
  await deleteDb(LEGACY_CAPTURE);
  return { subjects: putSubjects.length, modules: putModules.length, sessions: putSessions.length };
}
