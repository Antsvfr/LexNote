import type { TimelineMarker, TranscriptSegment } from '@/domain/capture';
import type { SourceDocument } from '@/domain/course';
import { buildOutline } from '@/services/study/outline';
import type { CourseMaterial } from '@/services/engine/chunking';

const t = (text: string) => ({ type: 'text', text });
export const P = (text: string) => ({ type: 'paragraph', content: [t(text)] });
export const H = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [t(text)] });
export const LB = (kind: string, text: string) => ({ type: 'legalBlock', attrs: { kind }, content: [P(text)] });
export const OL = (...items: string[]) => ({ type: 'orderedList', content: items.map((x) => ({ type: 'listItem', content: [P(x)] })) });

export const seg = (id: string, startMs: number, text: string, confidence = 0.9): TranscriptSegment => ({
  id, userId: 'u', sessionId: 's1', startMs, endMs: startMs + 4000, text, confidence, provider: 'fake', status: 'final', source: 'TRANSCRIPTION', verification: 'UNVERIFIED', createdAt: 'x',
});
export const marker = (id: string, atMs: number, reasons: TimelineMarker['reasons'] = ['exam']): TimelineMarker => ({ id, userId: 'u', sessionId: 's1', atMs, reasons, createdAt: 'x' });

export const doc = (over: Partial<SourceDocument> & { units?: { index: number; title?: string; text: string }[]; unitLabel?: 'page' | 'slide' | 'section' } = {}): SourceDocument => ({
  id: over.id ?? 'doc1', userId: 'u', sessionId: 's1', name: over.name ?? 'support.pdf', mime: 'application/pdf', format: 'pdf', size: 10, status: 'ready', unitLabel: over.unitLabel ?? 'page',
  count: over.units?.length ?? 1, wordCount: 10, extraction: { unitLabel: over.unitLabel ?? 'page', count: over.units?.length ?? 1, units: over.units ?? [{ index: 1, text: 'texte' }], warnings: [] },
  fileHash: 'h', addedAt: 'x', createdAt: 'x', updatedAt: 'x', ...over,
}) as SourceDocument;

/** Cours de droit des contrats — notes + transcription + support du professeur (PDF). */
export function material(over: Partial<CourseMaterial> & { notes?: unknown } = {}): CourseMaterial {
  const notes = over.notes ?? { type: 'doc', content: [
    H(1, 'Formation du contrat'), P('Le contrat se forme par la rencontre des volontés.'),
    H(2, 'Consentement'), P('Le consentement doit être libre et éclairé.'),
    H(3, 'Dol'), LB('definition', 'Dol : manœuvres destinées à tromper le cocontractant.'), LB('article', 'Art. 1137 : le dol est le fait d’obtenir le consentement par des manœuvres.'),
    LB('important', 'Le dol peut être commis par un tiers.'),
    H(3, 'Violence'), LB('definition', 'Violence : contrainte qui inspire la crainte d’un mal considérable.'),
    H(2, 'Capacité'), P('Toute personne peut contracter sauf incapacité.'),
  ] };
  return {
    sessionId: 's1', sessionTitle: 'Droit des contrats', outline: buildOutline('s1', 'Droit des contrats', notes),
    segments: [
      seg('g1', 0, 'Bonjour, aujourd’hui nous parlons de la formation du contrat et du consentement.'),
      seg('g2', 5000, 'Le dol, ce sont des manœuvres destinées à tromper le cocontractant, article 1137 du code civil.'),
      seg('g3', 10000, 'Attention, ça tombe à l’examen : le dol peut venir d’un tiers.'),
    ],
    markers: [marker('m1', 11000, ['exam'])],
    anchors: [{ id: 'a1', userId: 'u', sessionId: 's1', timestamp: 6000, notePosition: 10, textSnippet: 'Dol : manœuvres destinées à tromper', nearbyTranscriptSegmentIds: ['g2'], createdAt: 'x' }],
    documents: [doc({ units: [{ index: 17, text: 'Le dol suppose des manœuvres destinées à tromper le cocontractant. Art. 1137 du Code civil.' }, { index: 18, text: 'La violence : contrainte inspirant la crainte d’un mal considérable.' }] })],
    ...over,
  } as CourseMaterial;
}
