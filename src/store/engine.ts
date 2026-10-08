import { create } from 'zustand';
import type { GeneratedCourse, SourceDocument } from '@/domain/course';
import type { StorageAdapter } from '@/services/storage/types';
import type { CaptureStorage } from '@/services/capture/storage/types';
import type { CourseSession } from '@/domain/types';
import { newId } from '@/lib/ids';
import { importDocument, reanalyzeDocument, removeDocument, DuplicateDocumentError, type DocDeps } from '@/services/engine/documents';
import { loadMaterial } from '@/services/engine/material';
import { AbortedError, MemoryAnalysisCache } from '@/services/engine/context';
import { runCourseEngine, type Stage } from '@/services/engine/pipeline';
import { getActiveEngineProvider } from '@/services/engine/provider';
import type { Detection } from '@/services/engine/analyzer';
import { toast } from './toasts';

export interface RunState { state: 'idle' | 'running' | 'error'; stage?: Stage; done: number; total: number; error?: string }
const idle: RunState = { state: 'idle', done: 0, total: 1 };

interface EngineState {
  documents: SourceDocument[];
  courses: GeneratedCourse[];
  ready: boolean;
  runs: Record<string, RunState>;
  init(adapter: StorageAdapter, userId: string): Promise<void>;
  reload(): Promise<void>;
  reset(): void;
  importFiles(sessionId: string, files: File[]): Promise<void>;
  reanalyze(id: string): Promise<void>;
  removeDocument(id: string): Promise<void>;
  generate(session: CourseSession, opts: { capture: CaptureStorage | null; loadNotes: (id: string) => Promise<unknown>; fallbackToLocal?: boolean }): Promise<GeneratedCourse | null>;
  cancel(sessionId: string): void;
  deleteCourse(id: string): Promise<void>;
  forSession(sessionId: string): { documents: SourceDocument[]; courses: GeneratedCourse[] };
}

let adapter: StorageAdapter | null = null;
let uid = '';
const controllers = new Map<string, AbortController>();
const db = () => { if (!adapter) throw new Error('Le stockage LexNote n’est pas initialisé.'); return adapter; };
const deps = (): DocDeps => ({ adapter: db(), userId: uid });
const CACHE_MAX = 4000;

export const useEngine = create<EngineState>((set, get) => {
  const upsertDoc = (d: SourceDocument) => set((s) => ({ documents: s.documents.some((x) => x.id === d.id) ? s.documents.map((x) => (x.id === d.id ? d : x)) : [...s.documents, d] }));
  const setRun = (sid: string, r: RunState) => set((s) => ({ runs: { ...s.runs, [sid]: r } }));

  return {
    documents: [], courses: [], ready: false, runs: {},
    async init(a, userId) { adapter = a; uid = userId; set({ documents: await a.loadDocuments(), courses: await a.loadCourses(), ready: true, runs: {} }); },
    async reload() { if (adapter) set({ documents: await adapter.loadDocuments(), courses: await adapter.loadCourses() }); },
    reset() { controllers.forEach((c) => c.abort()); controllers.clear(); adapter = null; uid = ''; set({ documents: [], courses: [], ready: false, runs: {} }); },

    async importFiles(sessionId, files) {
      for (const f of files) {
        try { await importDocument(f, sessionId, deps(), upsertDoc); }
        catch (e) { if (e instanceof DuplicateDocumentError) toast.info(e.message); else toast.error(`Import impossible : ${(e as Error).message}`); }
      }
    },
    async reanalyze(id) { await reanalyzeDocument(id, deps(), upsertDoc); },
    async removeDocument(id) { set((s) => ({ documents: s.documents.filter((d) => d.id !== id) })); await removeDocument(id, deps()); },

    cancel(sid) { controllers.get(sid)?.abort(); },
    async generate(session, o) {
      if (get().runs[session.id]?.state === 'running') return null;
      const ctl = new AbortController(); controllers.set(session.id, ctl);
      setRun(session.id, { state: 'running', stage: 'sources', done: 0, total: 1 });
      try {
        const a = db();
        const material = await loadMaterial(session, { adapter: a, capture: o.capture, loadNotes: o.loadNotes });
        const key = `engine:cache:${session.id}`;
        const saved = (await a.getMeta<[string, Detection[]][]>(key)) ?? [];
        const cache = new MemoryAnalysisCache(new Map(saved));
        const provider = getActiveEngineProvider();
        const run = await runCourseEngine(material, {
          provider, fallbackToLocal: o.fallbackToLocal ?? true, cache, signal: ctl.signal,
          onProgress: (stage, done, total) => setRun(session.id, { state: 'running', stage, done, total }),
        });
        await a.setMeta(key, [...cache.map].slice(-CACHE_MAX));
        const now = new Date().toISOString();
        const version = Math.max(0, ...get().courses.filter((c) => c.sessionId === session.id).map((c) => c.courseVersion)) + 1;
        // Nouvelle VERSION : les cours précédents sont conservés tels quels.
        const course: GeneratedCourse = {
          id: newId(), userId: uid, sessionId: session.id, courseVersion: version, generatedAt: now, engineVersion: run.engineVersion, providerId: run.providerId,
          providerLabel: run.providerLabel, sourceSnapshot: run.snapshot, content: run.content, createdAt: now, updatedAt: now,
        };
        await a.commit({ putCourses: [course] });
        set((s) => ({ courses: [...s.courses, course] }));
        setRun(session.id, idle);
        if (run.fellBack) toast.info('Moteur distant injoignable : cours produit avec le moteur local.');
        return course;
      } catch (e) {
        if (e instanceof AbortedError) { setRun(session.id, idle); return null; }
        setRun(session.id, { state: 'error', done: 0, total: 1, error: (e as Error).message });
        return null;
      } finally { controllers.delete(session.id); }
    },
    async deleteCourse(id) { set((s) => ({ courses: s.courses.filter((c) => c.id !== id) })); await db().commit({ deleteCourses: [id] }); },
    forSession: (sid) => ({ documents: get().documents.filter((d) => d.sessionId === sid), courses: get().courses.filter((c) => c.sessionId === sid).sort((a, b) => b.courseVersion - a.courseVersion) }),
  };
});
