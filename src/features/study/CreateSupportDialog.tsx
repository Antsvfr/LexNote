import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BarChart3, BookOpen, Brain, CalendarClock, FileText, HelpCircle, ListOrdered, Network, Sparkles, type LucideIcon } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useLibrary } from '@/store/library';
import { useEngine } from '@/store/engine';
import { useUI } from '@/store/ui';
import { useAuth } from '@/store/auth';
import { useArtifacts } from '@/store/artifacts';
import { toast } from '@/store/toasts';
import { DIAGRAM_LABELS, DIAGRAM_TYPES, QUIZ_KINDS, QUIZ_KIND_LABELS, DIFFICULTY_LABELS, type ArtifactType, type Difficulty, type DiagramType, type MapOrientation, type QuizKind, type SheetMode } from '@/domain/study';
import { generateDraft, latestCourse, toArtifact, treeOf } from '@/services/study/engine';
import { EmptySourceError, comparableSections, suggestDiagramType, suggestSupports, type Suggestion } from '@/services/study/generators';
import { allNodes, scopeNode } from '@/services/study/courseTree';
import { sessionLabel } from '@/domain/session';

const CARDS: { id: ArtifactType; icon: LucideIcon; label: string; hint: string }[] = [
  { id: 'COURSE_SHEET', icon: FileText, label: 'Fiche', hint: 'L’essentiel du cours : Express, Standard ou Complète.' },
  { id: 'MIND_MAP', icon: Brain, label: 'Carte mentale', hint: 'La structure du cours, à explorer et replier.' },
  { id: 'DIAGRAM', icon: Network, label: 'Schéma', hint: 'Processus, raisonnement ou hiérarchie.' },
  { id: 'COMPARISON_TABLE', icon: BarChart3, label: 'Tableau comparatif', hint: 'Notions réellement comparables, côte à côte.' },
  { id: 'TIMELINE', icon: CalendarClock, label: 'Chronologie', hint: 'Les dates citées dans le cours.' },
  { id: 'METHOD', icon: ListOrdered, label: 'Méthode', hint: 'Étapes, questions à se poser, checklist.' },
  { id: 'FLASHCARDS', icon: BookOpen, label: 'Flashcards', hint: 'Question / réponse tirées de vos sources.' },
  { id: 'QUIZ', icon: HelpCircle, label: 'Quiz', hint: 'QCM, vrai/faux et questions courtes corrigés.' },
];
const COUNTS = [10, 20, 30] as const;

/** Création à la demande d'un support à partir du COURS RECONSTRUIT (jamais des notes brutes). */
export function CreateSupportDialog() {
  const preset = useUI((s) => s.supportDialog);
  const close = useUI((s) => s.closeSupportDialog);
  const navigate = useNavigate();
  const { sessions, subjects } = useLibrary();
  const courses = useEngine((s) => s.courses);
  const userId = useAuth((s) => s.user?.id);
  const add = useArtifacts((s) => s.add);
  const open = preset !== null;

  const [sessionId, setSessionId] = useState('');
  const [choice, setChoice] = useState<ArtifactType | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [mode, setMode] = useState<SheetMode>('standard');
  const [depth, setDepth] = useState(3);
  const [orientation, setOrientation] = useState<MapOrientation>('horizontal');
  const [diagramType, setDiagramType] = useState<DiagramType | ''>('');
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [count, setCount] = useState<number>(20);
  const [custom, setCustom] = useState(false);
  const [level, setLevel] = useState<Difficulty | 'all'>('all');
  const [kinds, setKinds] = useState<QuizKind[]>([...QUIZ_KINDS]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ordered = useMemo(() => [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [sessions]);
  useEffect(() => {
    if (!open) return;
    setSessionId(preset?.sessionId ?? ordered[0]?.id ?? ''); setSectionId(preset?.sectionId ?? ''); setChoice(preset?.type ?? null);
    const st = preset?.settings;
    setMode(st?.mode ?? 'standard'); setDepth(st?.depth ?? 3); setOrientation(st?.orientation ?? 'horizontal'); setDiagramType(st?.diagramType ?? '');
    setCompareIds(preset?.sectionIds ?? st?.conceptIds ?? []); setCount(st?.count ?? 20); setCustom(false); setLevel(st?.level ?? 'all'); setKinds(st?.quizKinds ?? [...QUIZ_KINDS]);
    setError(null); setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const course = useMemo(() => (sessionId ? latestCourse(courses, sessionId) : undefined), [courses, sessionId]);
  const tree = useMemo(() => (course ? treeOf(course) : null), [course]);
  const nodes = useMemo(() => (tree ? tree.sections : []), [tree]);
  const scope = tree ? scopeNode(tree, sectionId || undefined) : null;
  const suggestions: Suggestion[] = useMemo(() => (tree ? suggestSupports(tree) : []), [tree]);
  const suggested = useMemo(() => new Set<string>(suggestions.map((x) => x.type)), [suggestions]);
  const autoDiagram = useMemo(() => (tree && scope ? suggestDiagramType({ tree, scope }) : 'HIERARCHY'), [tree, scope]);
  const comparable = useMemo(() => (tree && scope ? comparableSections({ tree, scope }) : []), [tree, scope]);
  void allNodes;

  async function submit() {
    const s = sessions.find((x) => x.id === sessionId);
    if (!s || !course || !choice || !userId || busy) return;
    setBusy(true); setError(null);
    try {
      const settings = {
        mode, depth, orientation, diagramType: choice === 'DIAGRAM' ? (diagramType || undefined) : undefined,
        conceptIds: choice === 'COMPARISON_TABLE' && compareIds.length ? compareIds : undefined,
        count: Math.max(1, Math.min(60, count || 20)), level, quizKinds: kinds.length ? kinds : [...QUIZ_KINDS],
      };
      const draft = generateDraft(course, { type: choice, scope: sectionId ? { sectionId } : undefined, settings });
      const art = toArtifact(draft, { userId, subjectId: s.subjectId });
      await add(art);
      if (draft.notice) toast.info(draft.notice);
      else if (draft.omitted) toast.info(`${draft.omitted} élément(s) non affichés pour garder le support lisible.`);
      close();
      navigate(`/supports/${art.id}`);
    } catch (e) {
      setError(e instanceof EmptySourceError ? e.message : `Création impossible : ${(e as Error).message}`);
      setBusy(false);
    }
  }

  const subjectName = (id: string) => subjects.find((x) => x.id === id)?.name ?? '';
  const usesScope = choice && choice !== 'COMPARISON_TABLE' && nodes.length > 0;
  return (
    <Modal
      open={open} onClose={close} title="Créer un support" description="Généré à partir du cours reconstruit : rien n’est ajouté qui ne figure pas dans vos sources." onSubmit={submit}
      footer={<><button type="button" className="btn" onClick={close}>Annuler</button><button type="submit" className="btn btn--primary" disabled={!choice || !course || busy} data-testid="support-create">{busy ? 'Création…' : 'Créer'}</button></>}
    >
      {ordered.length === 0 ? <p className="muted">Créez d’abord une séance et prenez des notes.</p> : (
        <>
          <div className="field">
            <label htmlFor="sp-session">Cours</label>
            <select id="sp-session" className="select" value={sessionId} onChange={(e) => { setSessionId(e.target.value); setSectionId(''); setCompareIds([]); setError(null); }} data-testid="support-session">
              {ordered.map((s) => <option key={s.id} value={s.id}>{sessionLabel(s)} · {subjectName(s.subjectId)}</option>)}
            </select>
          </div>

          {!course ? (
            <div className="banner banner--warn" role="status" data-testid="support-nocourse">
              Ce cours n’a pas encore été reconstruit. <Link to={`/session/${sessionId}/course`} className="link" onClick={close}>Ouvrir l’espace « Cours »</Link> pour le générer, puis revenez ici.
            </div>
          ) : (
            <>
              <div className="typelist" role="radiogroup" aria-label="Type de support">
                {CARDS.map(({ id, icon: Icon, label, hint }) => (
                  <button key={id} type="button" role="radio" aria-checked={choice === id} className={`typeitem${choice === id ? ' is-on' : ''}`} onClick={() => { setChoice(id); setError(null); }} data-testid={`support-${id}`}>
                    <Icon size={18} aria-hidden /><span className="typeitem__txt"><strong>{label}</strong><span>{hint}</span></span>
                    {suggested.has(id) && <em className="typeitem__tip"><Sparkles size={11} /> suggéré</em>}
                  </button>
                ))}
              </div>
              {suggestions.length > 0 && !choice && <p className="muted supporthint" data-testid="support-suggestions">{suggestions.map((x) => x.text).join(' · ')}</p>}

              {choice && tree && (
                <div className="supportopts">
                  {usesScope && (
                    <div className="field">
                      <label htmlFor="sp-scope">Partie du cours</label>
                      <select id="sp-scope" className="select" value={sectionId} onChange={(e) => setSectionId(e.target.value)} data-testid="support-scope">
                        <option value="">Cours entier</option>
                        {nodes.map((s) => <option key={s.id} value={s.id}>{'— '.repeat(Math.max(0, s.level - 1))}{s.title}</option>)}
                      </select>
                    </div>
                  )}
                  {choice === 'COURSE_SHEET' && (
                    <div className="field"><span className="field-label">Longueur</span>
                      <div className="seg" role="radiogroup" aria-label="Mode de la fiche">
                        {([['express', 'Express'], ['standard', 'Standard'], ['complete', 'Complète']] as const).map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={mode === v} className={mode === v ? 'is-on' : ''} onClick={() => setMode(v)} data-testid={`mode-${v}`}>{l}</button>)}
                      </div>
                    </div>
                  )}
                  {choice === 'MIND_MAP' && (
                    <>
                      <div className="field"><span className="field-label">Profondeur</span>
                        <div className="seg" role="radiogroup" aria-label="Profondeur">
                          {[1, 2, 3, 4, 5].map((v) => <button key={v} type="button" role="radio" aria-checked={depth === v} className={depth === v ? 'is-on' : ''} onClick={() => setDepth(v)} data-testid={`depth-${v}`}>{v} niveau{v > 1 ? 'x' : ''}</button>)}
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
                        {DIAGRAM_TYPES.map((t) => <option key={t} value={t}>{DIAGRAM_LABELS[t]}</option>)}
                      </select>
                    </div>
                  )}
                  {choice === 'COMPARISON_TABLE' && (
                    <div className="field"><span className="field-label">Notions à comparer {comparable.length >= 2 ? '' : '(aucun groupe de notions comparables détecté)'}</span>
                      <div className="checks" data-testid="support-concepts">
                        {nodes.map((s) => (
                          <label key={s.id}><input type="checkbox" checked={compareIds.length ? compareIds.includes(s.id) : comparable.some((c) => c.id === s.id)} onChange={(e) => {
                            const base = compareIds.length ? compareIds : comparable.map((c) => c.id);
                            setCompareIds(e.target.checked ? [...base, s.id] : base.filter((x) => x !== s.id));
                          }} /> {s.title}</label>
                        ))}
                      </div>
                    </div>
                  )}
                  {(choice === 'FLASHCARDS' || choice === 'QUIZ') && (
                    <div className="field"><span className="field-label">Nombre de {choice === 'QUIZ' ? 'questions' : 'cartes'}</span>
                      <div className="seg" role="radiogroup" aria-label="Nombre">
                        {COUNTS.map((v) => <button key={v} type="button" role="radio" aria-checked={!custom && count === v} className={!custom && count === v ? 'is-on' : ''} onClick={() => { setCustom(false); setCount(v); }} data-testid={`count-${v}`}>{v}</button>)}
                        <button type="button" role="radio" aria-checked={custom} className={custom ? 'is-on' : ''} onClick={() => setCustom(true)}>Personnalisé</button>
                        {custom && <input className="input input--num" type="number" min={1} max={60} value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Nombre personnalisé" data-testid="count-custom" />}
                      </div>
                    </div>
                  )}
                  {choice === 'QUIZ' && (
                    <>
                      <div className="field"><label htmlFor="sp-level">Niveau</label>
                        <select id="sp-level" className="select" value={level} onChange={(e) => setLevel(e.target.value as Difficulty | 'all')}>
                          <option value="all">Tous niveaux</option>
                          {(Object.keys(DIFFICULTY_LABELS) as Difficulty[]).map((d) => <option key={d} value={d}>{DIFFICULTY_LABELS[d]}</option>)}
                        </select>
                      </div>
                      <div className="field"><span className="field-label">Types de questions</span>
                        <div className="checks">
                          {QUIZ_KINDS.map((k) => <label key={k}><input type="checkbox" checked={kinds.includes(k)} onChange={(e) => setKinds(e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k))} /> {QUIZ_KIND_LABELS[k]}</label>)}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
          {error && <div className="banner banner--warn" role="alert" data-testid="support-error">{error}</div>}
        </>
      )}
    </Modal>
  );
}
