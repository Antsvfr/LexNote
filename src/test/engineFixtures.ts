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

import type { GeneratedCourse } from '@/domain/course';
import { runCourseEngine } from '@/services/engine/pipeline';

/** Cours riche : trois vices du consentement, une méthode numérotée, des dates, une condition « si… alors ». */
export function richMaterial(over: Partial<CourseMaterial> = {}): CourseMaterial {
  const notes = { type: 'doc', content: [
    H(1, 'Formation du contrat'), P('Le contrat se forme par la rencontre des volontés.'),
    H(2, 'Consentement'), P('Le consentement doit être libre et éclairé.'),
    H(3, 'Erreur'), LB('definition', 'Erreur : fausse représentation de la réalité.'), LB('article', 'Art. 1132 : l’erreur de droit ou de fait est une cause de nullité.'), LB('example', 'Par exemple, l’acheteur croit acquérir un tableau authentique.'),
    H(3, 'Dol'), LB('definition', 'Dol : manœuvres destinées à tromper le cocontractant.'), LB('article', 'Art. 1137 : le dol est le fait pour un contractant d’obtenir le consentement par des manœuvres.'),
    LB('caselaw', 'Cass. civ. 3e, 15 janvier 2002 : réticence dolosive.'), LB('important', 'Le dol peut être commis par un tiers.'),
    H(3, 'Violence'), LB('definition', 'Violence : contrainte qui inspire la crainte d’un mal considérable.'), LB('article', 'Art. 1140 : il y a violence lorsqu’une partie s’engage sous la pression d’une contrainte.'),
    H(2, 'Capacité'), P('Toute personne peut contracter sauf incapacité.'), LB('important', 'Les mineurs non émancipés sont incapables.'),
    H(1, 'Méthode du cas pratique'), P('Attention, ne confondez pas les faits et la qualification. Quelle est la règle applicable ?'),
    OL('Identifier les faits pertinents', 'Qualifier juridiquement', 'Formuler le problème de droit', 'Énoncer la règle', 'Appliquer aux faits', 'Conclure'),
    H(1, 'Histoire de la réforme'), P('Le Code civil a été promulgué en 1804.'), P('L’ordonnance du 10 février 2016 réforme le droit des contrats.'), P('La loi de ratification date de 2018.'),
    H(1, 'Régime'), P('Si le consentement est vicié, alors le contrat est annulable.'),
  ] };
  return {
    sessionId: 's1', sessionTitle: 'Droit des contrats', outline: buildOutline('s1', 'Droit des contrats', notes),
    segments: [seg('g1', 3_752_000, 'Le dol, ce sont des manœuvres destinées à tromper le cocontractant, article 1137 du code civil.')], markers: [], anchors: [],
    documents: [doc({ name: 'cours.pdf', units: [{ index: 14, text: 'Dol : manœuvres destinées à tromper le cocontractant. Art. 1137 du Code civil.' }, { index: 15, text: 'Violence : contrainte qui inspire la crainte d’un mal considérable. Art. 1140.' }] })],
    ...over,
  } as CourseMaterial;
}

/** Cours reconstruit (version `v`) produit par le VRAI moteur de cours à partir d'une matière de test. */
export async function courseOf(m: CourseMaterial = richMaterial(), v = 1): Promise<GeneratedCourse> {
  const run = await runCourseEngine(m);
  return { id: `course-${v}`, userId: 'u', sessionId: m.sessionId, courseVersion: v, generatedAt: '2026-10-07T10:00:00.000Z', engineVersion: run.engineVersion, providerId: run.providerId, providerLabel: run.providerLabel, sourceSnapshot: run.snapshot, content: run.content, createdAt: 'x', updatedAt: 'x' };
}
