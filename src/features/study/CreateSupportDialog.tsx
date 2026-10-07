import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, BookOpen, Brain, CalendarClock, FileText, HelpCircle, ListOrdered, Network, Sparkles, Zap, type LucideIcon } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { useAuth } from '@/store/auth';
import { useArtifacts } from '@/store/artifacts';
import { toast } from '@/store/toasts';
import { DIAGRAM_LABELS, DIAGRAM_TYPES, type ArtifactType, type DiagramType, type MapDetail, type MapOrientation, type SheetMode } from '@/domain/study';
import { generateDraft, outlineFor, toArtifact, type StudyOptions } from '@/services/study/engine';
import { EmptySourceError, comparableSections, suggestDiagramType, suggestSupports, type Suggestion } from '@/services/study/generators';
import { allSections, type Outline } from '@/services/study/outline';
import { sessionLabel } from '@/domain/session';

type Choice = 'COURSE_SHEET' | 'MIND_MAP' | 'DIAGRAM' | 'COMPARISON_TABLE' | 'TIMELINE' | 'METHOD' | 'FLASHCARDS' | 'QUIZ' | 'SUMMARY';
const CARDS: { id: Choice; icon: LucideIcon; label: string; hint: string }[] = [
  { id: 'COURSE_SHEET', icon: FileText, label: 'Fiche de cours', hint: 'L’essentiel pour réviser, en 1 à 4 pages.' },
  { id: 'MIND_MAP', icon: Brain, label: 'Carte mentale', hint: 'La structure du cours, à explorer et à modifier.' },
  { id: 'DIAGRAM', icon: Network, label: 'Schéma', hint: 'Étapes, hiérarchie, raisonnement : le bon format pour ce passage.' },
  { id: 'COMPARISON_TABLE', icon: BarChart3, label: 'Tableau comparatif', hint: 'Notions proches côte à côte (définition, article, arrêt…).' },
  { id: 'TIMELINE', icon: CalendarClock, label: 'Chronologie', hint: 'Les dates citées dans le cours, dans l’ordre.' },
  { id: 'METHOD', icon: ListOrdered, label: 'Méthode / étapes', hint: 'Une suite d’étapes (cas pratique, démarche).' },
  { id: 'FLASHCARDS', icon: BookOpen, label: 'Flashcards', hint: 'Recto/verso à partir de vos définitions, articles et arrêts.' },
  { id: 'QUIZ', icon: HelpCircle, label: 'Quiz', hint: 'Auto-test de rappel : la réponse est votre propre passage.' },
  { id: 'SUMMARY', icon: Zap, label: 'Résumé express', hint: 'Une ligne par partie du cours.' },
];
const toType = (c: Choice): ArtifactType => (c === 'METHOD' ? 'DIAGRAM' : c === 'SUMMARY' ? 'COURSE_SHEET' : c);

export function CreateSupportDialog() {
  const preset = useUI((s) => s.supportDialog);
  const close = useUI((s) => s.closeSupportDialog);
  const navigate = useNavigate();
  const { sessions, subjects, loadNotes } = useLibrary();
  const userId = useAuth((s) => s.user?.id);
  const add = useArtifacts((s) => s.add);
  const open = preset !== null;

  const [sessionId, setSessionId] = useState('');
  const [choice, setChoice] = useState<Choice | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [mode, setMode] = useState<SheetMode>('standard');
  const [inc, setInc] = useState({ articles: true, caselaw: true, examples: true, exam: true, sources: true });
  const [detail, setDetail] = useState<MapDetail>('standard');
  const [orientation, setOrientation] = useState<MapOrientation>('horizontal');
  const [diagramType, setDiagramType] = useState<DiagramType | ''>('');
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ordered = useMemo(() => [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [sessions]);

  useEffect(() => {
    if (!open) return;
    const sid = preset?.sessionId ?? ordered[0]?.id ?? '';
    setSessionId(sid); setSectionId(preset?.sectionId ?? ''); setChoice(preset?.type ? (preset.type as Choice) : null);
    setMode(preset?.options?.mode ?? 'standard'); setDetail(preset?.options?.detail ?? 'standard'); setOrientation('horizontal');
    setDiagramType(preset?.options?.diagramType ?? ''); setCompareIds(preset?.sectionIds ?? []); setError(null); setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Plan du cours de la séance choisie (sections sélectionnables + suggestions).
  useEffect(() => {
    let live = true;
    setOutline(null);
    const s = sessions.find((x) => x.id === sessionId);
    if (!open || !s) return;
    void loadNotes(s.id).then((doc) => { if (live) setOutline(outlineFor(s.id, s.title || sessionLabel(s), doc)); });
    return () => { live = false; };
  }, [open, sessionId, sessions, loadNotes]);

  const suggestions: Suggestion[] = useMemo(() => (outline ? suggestSupports(outline) : []), [outline]);
  const suggested = useMemo(() => new Set<string>(suggestions.map((x) => x.type)), [suggestions]);
  const sectionsList = useMemo(() => (outline ? allSections(outline.root) : []), [outline]);
  const scopeNode = sectionsList.find((s) => s.id === sectionId) ?? outline?.root;
  const autoDiagram = useMemo(() => (outline && scopeNode ? suggestDiagramType({ outline, scope: scopeNode }) : 'HIERARCHY'), [outline, scopeNode]);
  const comparable = useMemo(() => (outline && scopeNode ? comparableSections({ outline, scope: scopeNode }) : []), [outline, scopeNode]);

  async function submit() {
    const s = sessions.find((x) => x.id === sessionId);
    if (!s || !outline || !choice || !userId || busy) return;
    setBusy(true); setError(null);
    try {
      const options: StudyOptions = {
        mode, detail, orientation,
        include: { articles: inc.articles, caselaw: inc.caselaw, examples: inc.examples, exam: inc.exam, sources: inc.sources },
        diagramType: choice === 'METHOD' ? 'PROCESS' : (diagramType || undefined),
        summary: choice === 'SUMMARY', compareSectionIds: compareIds.length ? compareIds : undefined,
      };
      const draft = await generateDraft(outline, { type: toType(choice), scope: sectionId ? { sectionId } : undefined, options });
      const art = toArtifact(draft, { userId, sessionId: s.id, subjectId: s.subjectId });
      art.type = toType(choice);
      await add(art);
      if (draft.omitted) toast.info(`${draft.omitted} élément(s) non affichés pour garder le support lisible — choisissez « Détaillée » pour tout voir.`);
      close();
      navigate(`/supports/${art.id}`);
    } catch (e) {
      setError(e instanceof EmptySourceError ? e.message : `Création impossible : ${(e as Error).message}`);
      setBusy(false);
    }
  }

  const subjectName = (id: string) => subjects.find((x) => x.id === id)?.name ?? '';
  return (
    <Modal
      open={open} onClose={close} title="Créer un support" description="Généré à partir de VOS notes : rien n’est ajouté qui ne figure pas dans le cours." onSubmit={submit}
      footer={<><button type="button" className="btn" onClick={close}>Annuler</button><button type="submit" className="btn btn--primary" disabled={!choice || !outline || busy} data-testid="support-create">{busy ? 'Création…' : 'Créer'}</button></>}
    >
      {ordered.length === 0 ? <p className="muted">Créez d’abord une séance et prenez des notes.</p> : (
        <>
          <div className="field">
            <label htmlFor="sp-session">Séance</label>
            <select id="sp-session" className="select" value={sessionId} onChange={(e) => { setSessionId(e.target.value); setSectionId(''); }} data-testid="support-session">
              {ordered.map((s) => <option key={s.id} value={s.id}>{sessionLabel(s)} · {subjectName(s.subjectId)}</option>)}
            </select>
          </div>

          <div className="supportgrid" role="radiogroup" aria-label="Type de support">
            {CARDS.map(({ id, icon: Icon, label, hint }) => (
              <button key={id} type="button" role="radio" aria-checked={choice === id} className={`supportcard${choice === id ? ' is-on' : ''}`} onClick={() => { setChoice(id); setError(null); }} data-testid={`support-${id}`}>
                <Icon size={20} aria-hidden /><strong>{label}</strong><span>{hint}</span>
                {suggested.has(id) && <em className="supportcard__tip"><Sparkles size={11} /> suggéré</em>}
              </button>
            ))}
          </div>
          {suggestions.length > 0 && !choice && <p className="muted supporthint" data-testid="support-suggestions">{suggestions.map((x) => x.text).join(' · ')}</p>}

          {choice && outline && (
            <div className="supportopts">
              {sectionsList.length > 0 && choice !== 'COMPARISON_TABLE' && (
                <div className="field">
                  <label htmlFor="sp-scope">Partie du cours</label>
                  <select id="sp-scope" className="select" value={sectionId} onChange={(e) => setSectionId(e.target.value)} data-testid="support-scope">
                    <option value="">Cours entier</option>
                    {sectionsList.map((s) => <option key={s.id} value={s.id}>{'— '.repeat(Math.max(0, s.level - 1))}{s.title}</option>)}
                  </select>
                </div>
              )}
              {choice === 'COURSE_SHEET' && (
                <>
                  <div className="field"><span className="field-label">Longueur</span>
                    <div className="seg" role="radiogroup" aria-label="Mode de la fiche">
                      {([['express', 'Express (≈ 1 page)'], ['standard', 'Standard (2–4 pages)'], ['complete', 'Complète']] as const).map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={mode === v} className={mode === v ? 'is-on' : ''} onClick={() => setMode(v)} data-testid={`mode-${v}`}>{l}</button>)}
                    </div>
                  </div>
                  <div className="field"><span className="field-label">Inclure</span>
                    <div className="checks">
                      {([['articles', 'Articles'], ['caselaw', 'Jurisprudences'], ['examples', 'Exemples'], ['exam', 'Points examen'], ['sources', 'Sources']] as const).map(([k, l]) => (
                        <label key={k}><input type="checkbox" checked={inc[k]} onChange={(e) => setInc({ ...inc, [k]: e.target.checked })} /> {l}</label>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {choice === 'MIND_MAP' && (
                <>
                  <div className="field"><span className="field-label">Niveau de détail</span>
                    <div className="seg" role="radiogroup" aria-label="Détail">
                      {([['simple', 'Simple (≤ 15)'], ['standard', 'Standard (≤ 30)'], ['detailed', 'Détaillée']] as const).map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={detail === v} className={detail === v ? 'is-on' : ''} onClick={() => setDetail(v)} data-testid={`detail-${v}`}>{l}</button>)}
                    </div>
                  </div>
                  <div className="field"><span className="field-label">Orientation</span>
                    <div className="seg" role="radiogroup" aria-label="Orientation">
                      {([['horizontal', 'Horizontale'], ['radial', 'Radiale'], ['vertical', 'Verticale']] as const).map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={orientation === v} className={orientation === v ? 'is-on' : ''} onClick={() => setOrientation(v)}>{l}</button>)}
                    </div>
                  </div>
                </>
              )}
              {choice === 'DIAGRAM' && (
                <div className="field">
                  <label htmlFor="sp-dtype">Type de schéma</label>
                  <select id="sp-dtype" className="select" value={diagramType} onChange={(e) => setDiagramType(e.target.value as DiagramType | '')} data-testid="support-dtype">
                    <option value="">Automatique — {DIAGRAM_LABELS[autoDiagram]}</option>
                    {DIAGRAM_TYPES.filter((t) => t !== 'TIMELINE').map((t) => <option key={t} value={t}>{DIAGRAM_LABELS[t]}</option>)}
                  </select>
                </div>
              )}
              {choice === 'COMPARISON_TABLE' && (
                <div className="field"><span className="field-label">Notions à comparer {comparable.length >= 2 ? '' : '(aucun groupe de notions proches détecté)'}</span>
                  <div className="checks">
                    {allSections(outline.root).map((s) => (
                      <label key={s.id}><input type="checkbox" checked={compareIds.length ? compareIds.includes(s.id) : comparable.some((c) => c.id === s.id)} onChange={(e) => {
                        const base = compareIds.length ? compareIds : comparable.map((c) => c.id);
                        setCompareIds(e.target.checked ? [...base, s.id] : base.filter((x) => x !== s.id));
                      }} /> {s.title}</label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {error && <div className="banner banner--warn" role="alert" data-testid="support-error">{error}</div>}
        </>
      )}
    </Modal>
  );
}
