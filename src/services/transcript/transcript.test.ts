import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@/domain/capture';
import { docSchema } from '@/domain/derived';
import { validateContent } from '@/domain/study';
import { AINotConfiguredError, AIOfflineError, AIUnavailableError, type AIRequest } from '@/services/ai';
import { createTestAIProvider, type TestAIMode } from '@/services/ai/testDouble';
import { buildTranscriptText, chunkParagraphs, paragraphsOfText, transcriptVersion } from './source';
import { cleanSentenceText, cleanTranscriptLocally } from './clean';
import { detectLanguage } from './language';
import { docToMarkdown, docToText, InvalidModelOutputError, markdownToBlocks, parseModelDoc } from './docFormat';
import { actionById, suggestActions, TRANSCRIPT_ACTIONS } from './actions';
import { digestCache, EmptyTranscriptError, paragraphsOfDoc, runTranscriptAction, toDerivedArtifact, TooShortError, type AIEngine, type DerivedSource } from './pipeline';

let n = 0;
const seg = (text: string, startMs: number, endMs = startMs + 3000, confidence?: number): TranscriptSegment => ({
  id: `seg-${n++}`, sessionId: 's1', startMs, endMs, text, provider: 'test', status: 'final', source: 'TRANSCRIPTION', verification: 'UNVERIFIED', createdAt: '2026-10-13T08:00:00Z',
  ...(confidence !== undefined ? { confidence } : {}),
});
const LECTURE = [
  'Alors aujourd’hui on va parler de l’offre et la demande.', 'Premièrement la demande.', 'La demande se définit comme la quantité qu’un acheteur souhaite acquérir à un prix donné.',
  'Ensuite l’offre.', 'L’offre désigne la quantité que les producteurs mettent sur le marché.', 'Contrairement à la demande, l’offre augmente avec le prix.',
  'Le prix d’équilibre est le prix pour lequel l’offre est égale à la demande.', 'C’est-à-dire le point où les deux courbes se croisent.',
];
const lectureSegs = (repeat = 1) => Array.from({ length: repeat }, (_, r) => LECTURE.map((t, k) => seg(t, (r * LECTURE.length + k) * 4000))).flat();

function engine(mode: TestAIMode = 'ok', maxInputChars = 4000) {
  const calls: AIRequest[] = [];
  let m = mode;
  const p = createTestAIProvider(() => m, calls);
  const e: AIEngine & { calls: AIRequest[]; set(x: TestAIMode): void } = { isAvailable: () => true, run: (r) => p.run(r), maxInputChars, calls, set: (x) => { m = x; } };
  return e;
}
const SESSION = { id: 's1', title: 'Cours 01 — Microéconomie', subjectId: 'sub1' };
const src = (segs: TranscriptSegment[]): DerivedSource => { const t = buildTranscriptText(segs); return { kind: 'original', paragraphs: t.paragraphs, version: t.version, words: t.words }; };

beforeEach(() => digestCache.clear());
afterEach(() => { Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }); });

describe('texte de travail', () => {
  it('regroupe en paragraphes aux pauses, marque les segments peu sûrs, version stable', () => {
    const segs = [seg('Bonjour à tous.', 0, 2000), seg('On commence.', 2500, 4000), seg('Nouveau thème après une pause.', 12_000, 14_000, 0.4)];
    const t = buildTranscriptText(segs);
    expect(t.paragraphs.map((p) => p.text)).toEqual(['Bonjour à tous. On commence.', 'Nouveau thème après une pause.']);
    expect(t.paragraphs[1]!.uncertain).toBe(true);
    expect(t.words).toBe(10);
    expect(buildTranscriptText(segs).version).toBe(t.version);
    expect(transcriptVersion([...segs, seg('Ajout.', 20_000)])).not.toBe(t.version);
  });
  it('sélection : seuls les segments de la plage', () => {
    const segs = lectureSegs();
    const t = buildTranscriptText(segs, { range: { startMs: 8000, endMs: 12_000 } });
    expect(t.text).toContain('La demande se définit');
    expect(t.text).not.toContain('Alors aujourd’hui');
  });
  it('découpage : aucune perte de texte, aucune partie au-delà de la limite', () => {
    const t = buildTranscriptText(lectureSegs(40));
    const chunks = chunkParagraphs(t.paragraphs, 1500);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.text.length <= 1500)).toBe(true);
    expect(chunks.map((c) => c.text).join(' ').replace(/\s+/g, ' ')).toBe(t.text.replace(/\s+/g, ' '));
    // paragraphe interminable sans ponctuation : coupé aux espaces, sans perte
    const long = chunkParagraphs([{ text: 'mot '.repeat(3000).trim(), startMs: 0, endMs: 1 }], 1000);
    expect(long.every((c) => c.text.length <= 1000)).toBe(true);
    expect(long.reduce((k, c) => k + c.words, 0)).toBe(3000);
  });
});

describe('nettoyage léger (sur l’appareil)', () => {
  it('retire hésitations et répétitions sans changer les mots', () => {
    const out = cleanSentenceText('euh alors le le prix euh d’équilibre c’est c’est le point', 'fr');
    expect(out).toBe('Alors le prix d’équilibre c’est le point.');
    expect(cleanSentenceText('um so the the demand curve uh shifts', 'en')).toBe('So the demand curve shifts.');
  });
  it('garde les passages incertains signalés et l’horodatage', () => {
    const t = buildTranscriptText([seg('euh bon bon on on commence', 0), seg('mot mal entendu', 9000, 10_000, 0.3)]);
    const { doc, stats } = cleanTranscriptLocally(t.paragraphs, 'fr');
    expect(doc.blocks[0]).toMatchObject({ kind: 'paragraph', text: 'Bon on commence.', startMs: 0 });
    expect(doc.blocks[1]).toMatchObject({ uncertain: true, startMs: 9000 });
    expect(stats.fillers).toBe(1); expect(stats.repetitions).toBe(2);
    expect(() => docSchema.parse(doc)).not.toThrow();
  });
  it('ne supprime jamais un mot qui ressemble à une hésitation dans une autre langue', () => {
    expect(cleanSentenceText('este método es simple', 'es')).toBe('Este método es simple.');
  });
});

describe('langue', () => {
  it('détecte les langues prioritaires, refuse de deviner sur un texte trop court', () => {
    expect(detectLanguage(LECTURE.join(' '))).toBe('fr');
    expect(detectLanguage('Today we talk about supply and demand. The price is the point where the two curves meet, and this is what we call equilibrium.')).toBe('en');
    expect(detectLanguage('Hallo')).toBeUndefined();
  });
});

describe('document : lecture d’une réponse de moteur, export', () => {
  it('JSON du schéma → validé, identifiants régénérés, champs inconnus ignorés', () => {
    const d = parseModelDoc('```json\n{"blocks":[{"kind":"heading","level":1,"text":"Offre et demande","evil":"<script>"},{"kind":"definition","term":"Demande","text":"quantité souhaitée"},{"kind":"callout","tone":"remember","text":"équilibre"},{"kind":"table","text":"","rows":[["Notion","Sens"],["Offre","↑ avec le prix"]]}]}\n```', 'fr');
    expect(d.blocks.map((b) => b.kind)).toEqual(['heading', 'definition', 'callout', 'table']);
    expect(JSON.stringify(d)).not.toContain('evil');
    expect(new Set(d.blocks.map((b) => b.id)).size).toBe(4);
  });
  it('Markdown accepté en secours ; réponse illisible → erreur claire, rien d’inventé', () => {
    const d = parseModelDoc('# Titre\n\n- un\n- deux\n\n> **À retenir** — l’essentiel\n\n| A | B |\n|---|---|\n| 1 | 2 |', 'fr');
    expect(d.blocks.map((b) => b.kind)).toEqual(['heading', 'bullet', 'bullet', 'callout', 'table']);
    expect(d.blocks[3]).toMatchObject({ tone: 'remember' });
    expect(() => parseModelDoc('   ', 'fr')).toThrow(InvalidModelOutputError);
    expect(() => parseModelDoc('{"blocks":[]}', 'fr')).toThrow(InvalidModelOutputError);
  });
  it('aller-retour Markdown et texte', () => {
    const blocks = markdownToBlocks('## Section\n\n**Prix** — le montant\n\n1. un\n2. deux');
    const md = docToMarkdown({ language: 'fr', blocks }, { title: 'Résumé' });
    expect(md).toContain('# Résumé'); expect(md).toContain('### Section'); expect(md).toContain('**Prix** — le montant'); expect(md).toContain('2. deux');
    expect(docToText({ language: 'fr', blocks })).toContain('Prix : le montant');
  });
});

describe('actions', () => {
  it('catalogue : 4 actions principales, chaque action produit un type connu', () => {
    expect(TRANSCRIPT_ACTIONS.filter((a) => a.group === 'primary').map((a) => a.label)).toEqual(['Résumer', 'Traduire', 'Structurer', 'Points clés']);
    for (const a of TRANSCRIPT_ACTIONS) expect(a.nature === 'support' ? a.supportType : a.docType).toBeTruthy();
  });
  it('suggestions contextuelles légères', () => {
    const cmp = 'Contrairement à la demande, alors que l’offre, par rapport à la demande, en revanche. '.repeat(3) + 'mot '.repeat(80);
    expect(suggestActions(cmp, 100).map((s) => s.actionId)).toContain('comparison');
    const dated = 'En 1945, en 1957, en 1992 puis en 2002 et 2008. '.repeat(1) + 'mot '.repeat(80);
    expect(suggestActions(dated, 100).map((s) => s.actionId)).toContain('timeline');
    expect(suggestActions('court', 3)).toEqual([]);
  });
});

describe('pipeline', () => {
  const summarize = actionById('summarize')!;
  it('IA non configurée : erreur explicite, aucune réponse simulée', async () => {
    const off: AIEngine = { isAvailable: () => false, run: async () => { throw new Error('ne doit pas être appelé'); }, maxInputChars: 4000 };
    await expect(runTranscriptAction({ action: summarize, session: SESSION, userId: 'u', source: src(lectureSegs(2)), ai: off })).rejects.toBeInstanceOf(AINotConfiguredError);
  });
  it('transcription vide / trop courte', async () => {
    const e = engine();
    await expect(runTranscriptAction({ action: summarize, session: SESSION, userId: 'u', source: src([]), ai: e })).rejects.toBeInstanceOf(EmptyTranscriptError);
    await expect(runTranscriptAction({ action: summarize, session: SESSION, userId: 'u', source: src([seg('Bonjour.', 0)]), ai: e })).rejects.toBeInstanceOf(TooShortError);
    expect(e.calls).toHaveLength(0);
    // une transcription très courte reste traduisible
    const t = await runTranscriptAction({ action: actionById('translate')!, session: SESSION, userId: 'u', source: src([seg('Bonjour à tous.', 0)]), ai: e, options: { targetLanguage: 'en' } });
    expect(t.content.blocks[0]!.text).toBe('[en] Bonjour à tous.');
  });
  it('hors ligne : erreur explicite (le nettoyage léger reste disponible)', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await expect(runTranscriptAction({ action: summarize, session: SESSION, userId: 'u', source: src(lectureSegs(2)), ai: engine() })).rejects.toBeInstanceOf(AIOfflineError);
    const c = await runTranscriptAction({ action: actionById('clean')!, session: SESSION, userId: 'u', source: src(lectureSegs()), ai: engine() });
    expect(c.generator.local).toBe(true);
  });
  it('résumé court : 1 appel, mode transmis, provenance complète', async () => {
    const e = engine();
    const s = src(lectureSegs(2));
    const out = await runTranscriptAction({ action: summarize, session: SESSION, userId: 'u', source: s, ai: e, options: { mode: 'express' } });
    expect(e.calls.map((c) => c.command)).toEqual(['summarize']);
    expect(e.calls[0]!.options).toMatchObject({ mode: 'express', outputLanguage: 'fr', sourceLanguage: 'fr' });
    expect(out.title).toBe('Résumé express — Cours 01 — Microéconomie');
    expect(out.provenance).toMatchObject({ from: 'transcript', sessionId: 's1', transcriptVersion: s.version, sourceKind: 'original', generationType: 'summarize', language: 'fr', options: { mode: 'express' }, parts: 1 });
    const art = toDerivedArtifact(out, { userId: 'u', session: SESSION, action: summarize });
    expect(art).toMatchObject({ type: 'SUMMARY', sourceType: 'transcript', sourceSessionIds: ['s1'], generationType: 'summarize', language: 'fr', sourceTranscriptVersion: s.version, generation: 1, userEdited: false });
    expect(() => validateContent('SUMMARY', art.content)).not.toThrow();
  });
  it('longue transcription : synthèses intermédiaires PUIS consolidation ; les synthèses sont réutilisées par l’action suivante', async () => {
    const e = engine('ok', 4000);
    const s = src(lectureSegs(60));
    expect(s.paragraphs.map((p) => p.text).join('').length).toBeGreaterThan(12_000);
    await runTranscriptAction({ action: summarize, session: SESSION, userId: 'u', source: s, ai: e });
    const digests = e.calls.filter((c) => c.command === 'digest').length;
    expect(digests).toBeGreaterThan(2);
    expect(e.calls.at(-1)).toMatchObject({ command: 'summarize', options: { fromDigest: true } });
    e.calls.length = 0;
    await runTranscriptAction({ action: actionById('key-points')!, session: SESSION, userId: 'u', source: s, ai: e });
    expect(e.calls.map((c) => c.command)).toEqual(['key-points']);
  });
  it('traduction : partie par partie, rien n’est condensé, l’original n’est pas modifié', async () => {
    const e = engine('ok', 4000);
    const s = src(lectureSegs(30));
    const before = JSON.stringify(s.paragraphs);
    const out = await runTranscriptAction({ action: actionById('translate')!, session: SESSION, userId: 'u', source: s, ai: e, options: { targetLanguage: 'de' } });
    expect(e.calls.every((c) => c.command === 'translate' && c.options?.targetLanguage === 'de')).toBe(true);
    expect(out.content.blocks.length).toBe(s.paragraphs.length);
    expect(out.language).toBe('de');
    expect(out.provenance).toMatchObject({ sourceLanguage: 'fr', options: { targetLanguage: 'de' } });
    expect(out.title).toBe('Traduction (Allemand) — Cours 01 — Microéconomie');
    expect(JSON.stringify(s.paragraphs)).toBe(before);
  });
  it('traduction du résumé seulement : la source est le support (provenance parent)', async () => {
    const e = engine();
    const sum = await runTranscriptAction({ action: summarize, session: SESSION, userId: 'u', source: src(lectureSegs(2)), ai: e });
    const paragraphs = paragraphsOfDoc(sum.content);
    const out = await runTranscriptAction({ action: actionById('translate')!, session: SESSION, userId: 'u', ai: e, options: { targetLanguage: 'en' },
      source: { kind: 'artifact', paragraphs, version: 'art-1', words: 50, parentArtifactId: 'art-1', language: 'fr' } });
    expect(out.provenance).toMatchObject({ sourceKind: 'artifact', parentArtifactId: 'art-1' });
  });
  it('erreurs serveur et réponses illisibles : rien n’est produit', async () => {
    await expect(runTranscriptAction({ action: summarize, session: SESSION, userId: 'u', source: src(lectureSegs(2)), ai: engine('error') })).rejects.toBeInstanceOf(AIUnavailableError);
    await expect(runTranscriptAction({ action: summarize, session: SESSION, userId: 'u', source: src(lectureSegs(2)), ai: engine('garbage') })).rejects.toBeInstanceOf(InvalidModelOutputError);
  });
  it('annulation', async () => {
    const ctl = new AbortController(); ctl.abort();
    await expect(runTranscriptAction({ action: summarize, session: SESSION, userId: 'u', source: src(lectureSegs(2)), ai: engine(), signal: ctl.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('sélection : le passage seul, avec sa plage', async () => {
    const e = engine();
    const t = buildTranscriptText(lectureSegs(), { range: { startMs: 8000, endMs: 20_000 } });
    const out = await runTranscriptAction({ action: actionById('translate')!, session: SESSION, userId: 'u', ai: e, options: { targetLanguage: 'en' }, source: { kind: 'selection', paragraphs: t.paragraphs, version: t.version, words: t.words, range: t.range! } });
    expect(out.provenance.range).toEqual({ startMs: 8000, endMs: 20_000 });
    expect(e.calls[0]!.input).not.toContain('Alors aujourd’hui');
    expect(paragraphsOfText('a\n\nb')).toHaveLength(2);
  });
});
