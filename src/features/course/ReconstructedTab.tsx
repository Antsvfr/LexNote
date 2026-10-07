import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Layers, Loader2, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import {
  BLOCK_LABELS, type CourseSectionNode, type GeneratedBlock, type GeneratedCourse, type SourceDocument,
} from '@/domain/course';
import type { CourseSession } from '@/domain/types';
import { useEngine } from '@/store/engine';
import { useLibrary } from '@/store/library';
import { captureManager } from '@/services/capture/manager';
import { getLocalAdapter } from '@/services/workspace';
import { buildSourceSet } from '@/services/engine/chunking';
import { loadMaterial } from '@/services/engine/material';
import { snapshotOf, STAGES } from '@/services/engine/pipeline';
import { getActiveEngineProvider, listEngineProviders, setActiveEngineProvider } from '@/services/engine/provider';
import { loadEngineSettings, saveEngineSettings } from '@/lib/engineSettings';
import { formatRelative } from '@/lib/dates';
import { confirm } from '@/components/confirm';
import { ConfidenceBadge, SourceBadge } from '@/components/SourceBadge';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
const numberOf = (level: number, i: number) => (level === 1 ? `${ROMAN[i] ?? i + 1}.` : level === 2 ? `${String.fromCharCode(65 + (i % 26))}.` : level === 3 ? `${i + 1}.` : `${String.fromCharCode(97 + (i % 26))})`);
const STAGE_LABEL: Record<(typeof STAGES)[number], string> = { sources: 'Lecture des sources', normalisation: 'Normalisation', contexte: 'Analyse du contenu', structure: 'Construction du plan', génération: 'Rédaction du cours', validation: 'Vérification des sources' };

export function ReconstructedTab({ session, documents }: { session: CourseSession; documents: SourceDocument[] }) {
  const { courses, runs, generate, cancel, deleteCourse } = useEngine();
  const loadNotes = useLibrary((s) => s.loadNotes);
  const mine = useMemo(() => courses.filter((c) => c.sessionId === session.id).sort((a, b) => b.courseVersion - a.courseVersion), [courses, session.id]);
  const [sel, setSel] = useState<string | null>(null);
  const course = mine.find((c) => c.id === sel) ?? mine[0];
  const run = runs[session.id];
  const running = run?.state === 'running';
  const [settings, setSettings] = useState(loadEngineSettings);
  const [stale, setStale] = useState(false);
  const [empty, setEmpty] = useState(false);
  const providers = listEngineProviders();

  // Les sources ont-elles changé depuis cette version ? (empreinte, sans relancer le moteur)
  useEffect(() => {
    let live = true;
    void loadMaterial(session, { adapter: getLocalAdapter(), capture: captureManager.getStorageOrNull(), loadNotes }).then((m) => {
      if (!live) return;
      const set = buildSourceSet(m);
      setEmpty(set.chunks.length === 0);
      setStale(!!course && snapshotOf(set.sources).hash !== course.sourceSnapshot.hash);
    });
    return () => { live = false; };
  }, [session, course, documents, loadNotes, courses.length]);

  const start = async () => {
    setActiveEngineProvider(settings.providerId);
    const c = await generate(session, { capture: captureManager.getStorageOrNull(), loadNotes, fallbackToLocal: settings.fallbackToLocal });
    if (c) setSel(c.id);
  };
  const stageIdx = run?.stage ? STAGES.indexOf(run.stage) : 0;

  return (
    <div className="rc" data-testid="course-tab">
      <header className="rc__bar">
        <div className="rc__meta">
          {course
            ? <span data-testid="course-meta"><strong>Version {course.courseVersion}</strong> · générée {formatRelative(course.generatedAt)} · {course.providerLabel} · moteur {course.engineVersion} · {course.sourceSnapshot.sources.length} source{course.sourceSnapshot.sources.length > 1 ? 's' : ''}</span>
            : <span className="muted">Aucun cours reconstruit pour l’instant.</span>}
        </div>
        <div className="rc__actions">
          {mine.length > 1 && (
            <select className="select" aria-label="Version du cours" value={course?.id} onChange={(e) => setSel(e.target.value)} data-testid="course-version">
              {mine.map((c) => <option key={c.id} value={c.id}>Version {c.courseVersion} — {new Date(c.generatedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</option>)}
            </select>
          )}
          {providers.length > 1 && (
            <select className="select" aria-label="Moteur" value={settings.providerId} onChange={(e) => setSettings(saveEngineSettings({ providerId: e.target.value }))} data-testid="engine-select">
              {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          )}
          <button className="btn btn--primary" onClick={() => void start()} disabled={running || empty} data-testid="generate-course">
            {running ? <Loader2 className="spin" /> : mine.length ? <RefreshCw /> : <Sparkles />} {mine.length ? 'Régénérer' : 'Reconstruire le cours'}
          </button>
          {course && <button className="btn btn--ghost btn--icon" aria-label="Supprimer cette version" onClick={async () => { if (await confirm({ title: 'Supprimer cette version ?', message: 'Vos notes, la transcription et les documents ne sont pas modifiés.', confirmLabel: 'Supprimer', danger: true })) { await deleteCourse(course.id); setSel(null); } }}><Trash2 /></button>}
        </div>
      </header>

      {providers.length > 1 && (
        <label className="checks rc__fallback"><input type="checkbox" checked={settings.fallbackToLocal} onChange={(e) => setSettings(saveEngineSettings({ fallbackToLocal: e.target.checked }))} /> Si le moteur est injoignable, utiliser le moteur local</label>
      )}

      {running && (
        <div className="rc__progress" role="status" data-testid="course-progress">
          <ol>{STAGES.map((s, i) => <li key={s} className={i < stageIdx ? 'is-done' : i === stageIdx ? 'is-on' : ''}>{STAGE_LABEL[s]}</li>)}</ol>
          <button className="btn btn--sm" onClick={() => cancel(session.id)}><X /> Annuler</button>
        </div>
      )}
      {run?.state === 'error' && (
        <div className="banner banner--warn" role="alert" data-testid="course-error">
          <AlertTriangle size={18} aria-hidden /><span><strong>Cours non généré.</strong> {run.error} Vos notes, la transcription et les documents ne sont pas affectés.</span><span className="spacer" />
          <button className="btn btn--sm" onClick={() => void start()}>Réessayer</button>
          {getActiveEngineProvider().id !== 'local' && <button className="btn btn--sm" onClick={() => { setSettings(saveEngineSettings({ providerId: 'local' })); setActiveEngineProvider('local'); void generate(session, { capture: captureManager.getStorageOrNull(), loadNotes, fallbackToLocal: false }); }}>Utiliser le moteur local</button>}
        </div>
      )}
      {empty && !course && <div className="panel empty"><strong>Pas encore de matière à reconstruire</strong>Prenez des notes, enregistrez la séance ou ajoutez un document dans « Sources ».</div>}
      {stale && !running && <div className="banner" data-testid="course-stale"><Layers size={18} aria-hidden /><span><strong>Les sources ont changé depuis cette version.</strong> Régénérer crée une nouvelle version ; celle-ci est conservée.</span></div>}

      {course && <CourseView course={course} session={session} />}
    </div>
  );
}

function CourseView({ course, session }: { course: GeneratedCourse; session: CourseSession }) {
  const c = course.content;
  const toc = useMemo(() => { const out: { id: string; title: string; num: string; level: number }[] = []; const walk = (secs: CourseSectionNode[], level: number) => secs.forEach((s, i) => { out.push({ id: s.id, title: s.title, num: numberOf(level, i), level }); walk(s.children, level + 1); }); walk(c.sections, 1); return out; }, [c.sections]);
  const verify = c.toVerify;
  return (
    <div className="rc__layout">
      <nav className="rc__toc" aria-label="Plan du cours">
        <strong>Plan</strong>
        <ul>{toc.map((t) => <li key={t.id} style={{ paddingLeft: (t.level - 1) * 12 }}><a href={`#${t.id}`}><span>{t.num}</span> {t.title}</a></li>)}
          {verify.length > 0 && <li><a href="#a-verifier"><AlertTriangle size={12} /> À vérifier ({verify.length})</a></li>}</ul>
        <div className="rc__legend" aria-label="Légende des sources">
          <span className="srcbadge srcbadge--notes srcbadge--static">Notes</span><span className="srcbadge srcbadge--transcript srcbadge--static">Transcription</span>
          <span className="srcbadge srcbadge--document srcbadge--static">Document</span><span className="srcbadge srcbadge--gen srcbadge--static">Généré</span>
        </div>
      </nav>
      <article className="rc__doc" data-testid="course-doc">
        <h1 className="rc__title">{c.title}</h1>
        <p className="rc__stats muted">{c.stats.blocks} éléments · {Object.entries(c.stats.byConfidence).map(([k, v]) => `${v} ${k === 'VERIFIED' ? 'corroborés' : k === 'SUPPORTED' ? 'appuyés' : k === 'UNCERTAIN' ? 'incertains' : k === 'CONFLICTING' ? 'en conflit' : 'sans source'}`).join(' · ')}{c.stats.dropped ? ` · ${c.stats.dropped} écartés faute de source` : ''}</p>
        {c.intro && <section className="rc__intro"><Block b={c.intro} sessionId={session.id} /></section>}
        {c.sections.map((s, i) => <Section key={s.id} s={s} idx={i} level={1} sessionId={session.id} />)}
        {c.conclusion && <section className="rc__conclusion"><h2>Conclusion</h2><Block b={c.conclusion} sessionId={session.id} /></section>}
        {verify.length > 0 && (
          <section id="a-verifier" className="rc__verify" data-testid="to-verify">
            <h2><AlertTriangle size={18} /> Points à vérifier</h2>
            <p className="muted">Zones ambiguës, passages incomplets, contradictions entre sources et informations non confirmées. Rien ici n’est présenté comme certain.</p>
            {verify.map((b) => <Block key={b.id} b={b} sessionId={session.id} />)}
          </section>
        )}
        <footer className="rc__foot muted">Cours reconstruit à partir de vos sources, sans les modifier. Vérifiez toujours les références juridiques auprès d’une source officielle.</footer>
      </article>
    </div>
  );
}

function Section({ s, idx, level, sessionId }: { s: CourseSectionNode; idx: number; level: number; sessionId: string }) {
  const H = (`h${Math.min(level + 1, 5)}`) as 'h2' | 'h3' | 'h4' | 'h5';
  return (
    <section id={s.id} className={`rc__sec rc__sec--l${Math.min(level, 4)}`} data-testid="course-section">
      <H><span className="rc__num">{numberOf(level, idx)}</span> {s.title}{s.titleOrigin !== 'notes' && <small className="rc__deduced" title="Ce titre ne vient pas de vos notes">{s.titleOrigin === 'document' ? 'titre du document' : 'titre déduit'}</small>}</H>
      {s.blocks.map((b) => <Block key={b.id} b={b} sessionId={sessionId} />)}
      {s.children.map((c, i) => <Section key={c.id} s={c} idx={i} level={level + 1} sessionId={sessionId} />)}
    </section>
  );
}

function Block({ b, sessionId }: { b: GeneratedBlock; sessionId: string }) {
  return (
    <div className={`blk blk--${b.kind} blk--${b.confidence.toLowerCase()}`} data-testid="course-block" data-kind={b.kind} data-confidence={b.confidence} id={b.id}>
      <div className="blk__head">
        <span className="blk__kind">{BLOCK_LABELS[b.kind]}</span>
        {b.label && <strong className="blk__label">{b.label}</strong>}
        <span className="blk__meta"><SourceBadge refs={b.refs} sessionId={sessionId} generated={b.origin === 'generated'} /><ConfidenceBadge level={b.confidence} note={b.note} /></span>
      </div>
      {b.kind === 'method' && b.steps?.length ? <ol className="blk__steps">{b.steps.map((st, i) => <li key={i}>{st}</li>)}</ol> : <p className="blk__text">{b.text}</p>}
      {b.conflict && b.conflict.values.length > 0 && (
        <div className="blk__conflict" data-testid="conflict">
          {b.conflict.values.map((v, i) => <div key={i}><strong>{v.value}</strong><SourceBadge refs={v.refs} sessionId={sessionId} /></div>)}
        </div>
      )}
      {b.note && <p className="blk__note">{b.note}</p>}
    </div>
  );
}
