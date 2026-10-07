import { create } from 'zustand';
import type { ArtifactContent, StudyArtifact } from '@/domain/study';
import type { StorageAdapter } from '@/services/storage/types';
import { newId } from '@/lib/ids';

interface ArtifactsState {
  items: StudyArtifact[];
  ready: boolean;
  init(adapter: StorageAdapter): Promise<void>;
  reload(): Promise<void>;
  reset(): void;
  add(a: StudyArtifact): Promise<void>;
  /** Modification par l'utilisateur : `content` change, la version générée (`aiContent`) reste intacte. */
  edit(id: string, content: ArtifactContent, title?: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  /** Revient à la version générée. */
  restoreGenerated(id: string): Promise<void>;
  /** Remplace par une nouvelle génération (le contenu précédent est perdu : l'appelant a confirmé ou fait une copie). */
  replaceGenerated(id: string, draft: Pick<StudyArtifact, 'content' | 'sourceHash' | 'generatedBy' | 'title'>): Promise<void>;
  duplicate(id: string, title?: string): Promise<StudyArtifact | undefined>;
  remove(id: string): Promise<void>;
  removeForSubject(subjectId: string): Promise<void>;
}

let adapter: StorageAdapter | null = null;
const db = () => { if (!adapter) throw new Error('Le stockage LexNote n’est pas initialisé.'); return adapter; };
const stamp = () => new Date().toISOString();
const replace = (list: StudyArtifact[], a: StudyArtifact) => list.map((x) => (x.id === a.id ? a : x));

export const useArtifacts = create<ArtifactsState>((set, get) => {
  async function put(next: StudyArtifact) {
    set((s) => ({ items: s.items.some((x) => x.id === next.id) ? replace(s.items, next) : [...s.items, next] }));
    await db().commit({ putArtifacts: [next] });
  }
  const find = (id: string) => get().items.find((x) => x.id === id);

  return {
    items: [], ready: false,
    async init(a) { adapter = a; set({ items: await a.loadArtifacts(), ready: true }); },
    async reload() { if (adapter) set({ items: await adapter.loadArtifacts() }); },
    reset() { adapter = null; set({ items: [], ready: false }); },
    add: (a) => put(a),
    async edit(id, content, title) {
      const cur = find(id); if (!cur) return;
      await put({ ...cur, content, title: title ?? cur.title, userEdited: true, updatedAt: stamp() });
    },
    async rename(id, title) {
      const cur = find(id); if (!cur || !title.trim()) return;
      await put({ ...cur, title: title.trim(), updatedAt: stamp() });
    },
    async restoreGenerated(id) {
      const cur = find(id); if (!cur?.aiContent) return;
      await put({ ...cur, content: structuredClone(cur.aiContent), userEdited: false, updatedAt: stamp() });
    },
    async replaceGenerated(id, d) {
      const cur = find(id); if (!cur) return;
      await put({ ...cur, title: cur.userEdited ? cur.title : d.title, content: d.content, aiContent: structuredClone(d.content), sourceHash: d.sourceHash, generatedBy: d.generatedBy, userEdited: false, updatedAt: stamp() });
    },
    async duplicate(id, title) {
      const cur = find(id); if (!cur) return undefined;
      const now = stamp();
      const copy: StudyArtifact = { ...structuredClone(cur), id: newId(), title: title ?? `${cur.title} (copie)`, version: undefined, dirty: undefined, createdAt: now, updatedAt: now };
      await put(copy);
      return copy;
    },
    async remove(id) {
      set((s) => ({ items: s.items.filter((x) => x.id !== id) }));
      await db().commit({ deleteArtifacts: [id] });
    },
    async removeForSubject(subjectId) {
      const ids = get().items.filter((x) => x.subjectId === subjectId).map((x) => x.id);
      if (!ids.length) return;
      set((s) => ({ items: s.items.filter((x) => !ids.includes(x.id)) }));
      await db().commit({ deleteArtifacts: ids });
    },
  };
});
