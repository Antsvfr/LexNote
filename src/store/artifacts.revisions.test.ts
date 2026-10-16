import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAdapter } from '@/services/storage/memoryAdapter';
import { MAX_REVISIONS, type DocContent, type TranscriptProvenance } from '@/domain/derived';
import type { StudyArtifact } from '@/domain/study';
import { useArtifacts } from './artifacts';

const doc = (t: string): DocContent => ({ language: 'fr', blocks: [{ id: 'b', kind: 'paragraph', text: t }] });
const prov = (v: string): TranscriptProvenance => ({
  from: 'transcript', sessionId: 's1', transcriptVersion: v, sourceKind: 'original', generationType: 'summarize', generator: { providerId: 'remote:x', model: 'm', local: false },
  language: 'fr', options: { mode: 'standard' }, inputWords: 100, parts: 1, generatedAt: '2026-10-13T00:00:00Z',
});
const art = (): StudyArtifact => ({
  id: 'a1', userId: 'u', type: 'SUMMARY', title: 'Résumé', subjectId: null, sourceSessionIds: ['s1'], scope: null, settings: {}, content: doc('généré v1'), generatedContent: doc('généré v1'),
  courseId: '', courseVersion: 0, sourceSnapshot: { sources: [], hash: '' } as unknown as StudyArtifact['sourceSnapshot'], engineVersion: 'm', provenance: prov('t1'), generation: 1, userEdited: false,
  sourceType: 'transcript', generationType: 'summarize', language: 'fr', sourceTranscriptVersion: 't1', generator: { providerId: 'remote:x', model: 'm', local: false }, revisions: [],
  createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z',
});
const cur = () => useArtifacts.getState().items[0]!;

describe('versions des documents dérivés', () => {
  let adapter: MemoryAdapter;
  beforeEach(async () => { adapter = new MemoryAdapter(true); await useArtifacts.getState().init(adapter); await useArtifacts.getState().add(art()); });

  it('une version modifiée par l’utilisateur n’est JAMAIS perdue à la régénération', async () => {
    await useArtifacts.getState().edit('a1', doc('ma version corrigée'));
    expect(cur().userEdited).toBe(true);
    await useArtifacts.getState().regenerateDerived('a1', { content: doc('généré v2'), provenance: prov('t2'), generator: cur().generator, language: 'fr', sourceTranscriptVersion: 't2', settings: {} });
    expect(cur()).toMatchObject({ generation: 2, userEdited: false, sourceTranscriptVersion: 't2' });
    expect((cur().content as DocContent).blocks[0]!.text).toBe('généré v2');
    expect(cur().revisions![0]).toMatchObject({ generation: 1, userEdited: true });
    expect((cur().revisions![0]!.content as DocContent).blocks[0]!.text).toBe('ma version corrigée');
    // persisté
    const stored = (await adapter.loadArtifacts()).find((x) => x.id === 'a1')!;
    expect(stored.revisions).toHaveLength(1);
  });
  it('restaurer une version conserve la version courante', async () => {
    await useArtifacts.getState().edit('a1', doc('ma version'));
    await useArtifacts.getState().regenerateDerived('a1', { content: doc('généré v2'), provenance: prov('t2'), generator: cur().generator, language: 'fr', sourceTranscriptVersion: 't2', settings: {} });
    await useArtifacts.getState().restoreRevision('a1', 1);
    expect((cur().content as DocContent).blocks[0]!.text).toBe('ma version');
    expect(cur().revisions!.some((r) => (r.content as DocContent).blocks[0]!.text === 'généré v2')).toBe(true);
  });
  it('historique borné', async () => {
    for (let k = 0; k < MAX_REVISIONS + 4; k++) {
      await useArtifacts.getState().regenerateDerived('a1', { content: doc(`v${k + 2}`), provenance: prov('t'), generator: cur().generator, language: 'fr', sourceTranscriptVersion: 't', settings: {} });
    }
    expect(cur().revisions).toHaveLength(MAX_REVISIONS);
    expect(cur().generation).toBe(MAX_REVISIONS + 5);
  });
  it('titre modifié par l’utilisateur conservé à la régénération', async () => {
    await useArtifacts.getState().edit('a1', doc('x'), 'Mon titre');
    await useArtifacts.getState().regenerateDerived('a1', { content: doc('y'), provenance: prov('t2'), generator: cur().generator, language: 'fr', sourceTranscriptVersion: 't2', settings: {}, title: 'Titre généré' });
    expect(cur().title).toBe('Mon titre');
  });
});
