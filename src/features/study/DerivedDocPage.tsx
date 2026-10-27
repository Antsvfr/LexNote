import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, ClipboardCopy, Copy, Download, History, Languages, Pencil, Printer, RefreshCw, SplitSquareHorizontal, Trash2, Undo2 } from 'lucide-react';
import { useArtifacts } from '@/store/artifacts';
import { useLibrary } from '@/store/library';
import { toast } from '@/store/toasts';
import { confirm } from '@/components/confirm';
import { Menu } from '@/components/Menu';
import { debounce } from '@/lib/debounce';
import { formatRelative } from '@/lib/dates';
import { formatHMS } from '@/domain/capture';
import { ARTIFACT_LABELS, isTranscriptProvenance, type StudyArtifact } from '@/domain/study';
import { DERIVED_SOURCE_LABELS, languageLabel, type DocContent } from '@/domain/derived';
import { docToMarkdown, docToText } from '@/services/transcript/docFormat';
import { actionById } from '@/services/transcript/actions';
import { buildTranscriptText } from '@/services/transcript/source';
import { loadSegments, regenerate, sourceFromArtifact } from '@/services/transcript/run';
import type { Progress } from '@/services/transcript/pipeline';
import { downloadBlob, fileSafe } from '@/services/study/export';
import { ActionDialog, errorMessage, type ActionRequest } from '@/features/transcript/ActionDialog';
import { DocView } from './views/DocView';

const FOOTER = 'Généré par LexNote à partir de votre transcription — à vérifier avec vos sources avant tout usage.';

async function copy(text: string, ok = 'Copié dans le presse-papiers.') {
  try { await navigator.clipboard.writeText(text); toast.success(ok); } catch { toast.error('Copie impossible : le navigateur l’a refusée.'); }
}

/** Document dérivé de la transcription : lecture, édition, versions, original, export. */
export function DerivedDocPage({ art }: { art: StudyArtifact }) {
  const navigate = useNavigate();
  const { items, edit, rename, restoreGenerated, restoreRevision, duplicate, remove } = useArtifacts();
  const session = useLibrary((s) => s.sessions.find((x) => x.id === art.sourceSessionIds[0]));
  const prov = isTranscriptProvenance(art.provenance) ? art.provenance : null;
  const parent = prov?.parentArtifactId ? items.find((x) => x.id === prov.parentArtifactId) : undefined;
  const [draft, setDraft] = useState<DocContent>(art.content as DocContent);
  const [title, setTitle] = useState(art.title);
  const [editing, setEditing] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [original, setOriginal] = useState<DocContent | null>(null);
  const [history, setHistory] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState(false);
  const [req, setReq] = useState<ActionRequest | null>(null);
  const saver = useRef<ReturnType<typeof debounce<[string, DocContent]>> | null>(null);
  const area = useRef<HTMLDivElement>(null);

  useEffect(() => { saver.current = debounce((id: string, c: DocContent) => { void edit(id, c); }, 500, 3000); return () => saver.current?.flush(); }, [edit]);
  useEffect(() => { if (!saver.current?.pending()) { setDraft(art.content as DocContent); setTitle(art.title); } }, [art.id, art.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // L'original : le support parent (traduction d'un résumé…), sinon la transcription (ou le passage) — toujours accessible.
  useEffect(() => {
    if (!showOriginal || !prov) return;
    if (parent) { setOriginal(parent.content as DocContent); return; }
    let live = true;
    void loadSegments(prov.sessionId).then((segs) => {
      if (!live) return;
      const t = buildTranscriptText(segs, prov.sourceKind === 'selection' && prov.range ? { range: prov.range } : {});
      setOriginal({ language: prov.sourceLanguage ?? 'und', blocks: t.paragraphs.map((p, k) => ({ id: `o${k}`, kind: 'paragraph' as const, text: p.text, startMs: p.startMs, ...(p.uncertain ? { uncertain: true } : {}) })) });
    });
    return () => { live = false; };
  }, [showOriginal, prov, parent]);

  const change = (c: DocContent) => { setDraft(c); saver.current?.(art.id, c); };
  const action = prov ? actionById(prov.generationType) : undefined;
  const canRegenerate = !!action && action.nature !== 'support';
  const md = (c: DocContent) => docToMarkdown(c, { title: art.title, footer: FOOTER, timestamps: art.type === 'CLEAN_TRANSCRIPT' });
  const base = fileSafe(art.title);
  const selectionText = () => { const s = window.getSelection(); return s && !s.isCollapsed && area.current?.contains(s.anchorNode) ? s.toString().trim() : ''; };
  const onTime = session ? (ms: number) => navigate(`/session/${session.id}/recap?t=${ms}`) : undefined;
  const sourceLabel = useMemo(() => {
    if (!prov) return 'source inconnue';
    if (prov.sourceKind === 'selection' && prov.range) return `${DERIVED_SOURCE_LABELS.selection} (${formatHMS(prov.range.startMs)} – ${formatHMS(prov.range.endMs)})`;
    if (prov.sourceKind === 'artifact') return parent ? `« ${parent.title} »` : 'un support supprimé';
    return DERIVED_SOURCE_LABELS[prov.sourceKind];
  }, [prov, parent]);

  async function doRegenerate() {
    if (busy) return;
    if (art.userEdited && !(await confirm({ title: 'Régénérer ce support ?', message: 'Une nouvelle version sera générée depuis la source actuelle. Votre version modifiée est conservée dans l’historique : vous pourrez la restaurer.', confirmLabel: 'Régénérer' }))) return;
    saver.current?.flush(); setBusy(true); setProgress(null);
    try { const { notice } = await regenerate(art, setProgress); toast.success('Nouvelle version générée ; la précédente est dans l’historique.'); if (notice) toast.info(notice); }
    catch (e) { toast.error(e instanceof Error && e.name === 'Error' ? e.message : errorMessage(e)); }
    finally { setBusy(false); setProgress(null); }
  }

  return (
    <div className="page page-enter artifact derived" data-testid="artifact-page" data-type={art.type}>
      <nav className="crumbs no-print" aria-label="Fil d’Ariane">
        {session ? <Link to={`/session/${session.id}/recap`}>{session.title || 'Séance'}</Link> : <span>Séance supprimée</span>} › <Link to="/supports">Mes supports</Link> ›
      </nav>
      <header className="page__head no-print">
        <div style={{ flex: 1, minWidth: 0 }}>
          <input className="artifact__title" aria-label="Titre du support" value={title} data-testid="artifact-title" onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== art.title && void rename(art.id, title)} />
          <p className="page__sub">
            <span className="tag">{ARTIFACT_LABELS[art.type]}</span>{' '}
            {art.language && art.language !== 'und' && <><span className="tag" data-testid="artifact-language">{languageLabel(art.language)}</span>{' '}</>}
            {art.userEdited ? <span className="tag tag--live" data-testid="artifact-edited">Modifié par vous</span> : <span className="tag" data-testid="artifact-generated">Version générée</span>}{' '}
            <span className="tag" data-testid="artifact-generator">{art.generator?.local ? 'Sur l’appareil' : `IA · ${art.generator?.model ?? '—'}`}</span>
            {' '}· version {art.generation} · modifié {formatRelative(art.updatedAt)}
          </p>
        </div>
        <div className="row-actions">
          <button className={`btn${editing ? ' btn--primary' : ''}`} onClick={() => { if (editing) saver.current?.flush(); setEditing((v) => !v); }} data-testid="doc-edit-toggle">{editing ? <><Check /> Terminer</> : <><Pencil /> Modifier</>}</button>
          <button className={`btn${showOriginal ? ' is-on' : ''}`} onClick={() => setShowOriginal((v) => !v)} aria-pressed={showOriginal} data-testid="doc-original"><SplitSquareHorizontal /> {showOriginal ? 'Masquer l’original' : 'Voir l’original'}</button>
          <Menu trigger={(p) => <button className="btn" {...p} data-testid="export-menu"><Download /> Exporter</button>}>
            {(close) => (
              <>
                <button className="menu__item" role="menuitem" data-testid="export-md" onClick={() => { close(); downloadBlob(`${base}.md`, new Blob([md(draft)], { type: 'text/markdown;charset=utf-8' })); }}>Markdown (.md)</button>
                <button className="menu__item" role="menuitem" data-testid="export-txt" onClick={() => { close(); downloadBlob(`${base}.txt`, new Blob([docToText(draft, { title: art.title })], { type: 'text/plain;charset=utf-8' })); }}>Texte (.txt)</button>
                <button className="menu__item" role="menuitem" data-testid="export-copy" onClick={() => { close(); void copy(md(draft)); }}><ClipboardCopy /> Copier tout (Markdown)</button>
                <button className="menu__item" role="menuitem" data-testid="export-selection" onClick={() => { close(); const t = selectionText(); if (t) void copy(t, 'Sélection copiée.'); else toast.info('Sélectionnez d’abord un passage du document.'); }}>Copier la sélection</button>
                <button className="menu__item" role="menuitem" data-testid="export-print" onClick={() => { close(); setTimeout(() => window.print(), 50); }}><Printer />Imprimer / PDF</button>
              </>
            )}
          </Menu>
          {art.type !== 'TRANSLATION' && <button className="btn" onClick={() => session && setReq({ action: actionById('translate')!, sessionId: session.id, transcript: sourceFromArtifact(art) })} disabled={!session} data-testid="doc-translate" title="Traduire ce document"><Languages /> Traduire</button>}
          <button className="btn" onClick={() => void doRegenerate()} disabled={!canRegenerate || busy} aria-label="Régénérer" title="Régénérer (la version actuelle est conservée)" data-testid="artifact-regenerate"><RefreshCw className={busy ? 'spin' : ''} /></button>
          <button className="btn" onClick={async () => { const c = await duplicate(art.id); if (c) { toast.success('Support dupliqué.'); navigate(`/supports/${c.id}`); } }} aria-label="Dupliquer"><Copy /></button>
          <button className="btn btn--danger" aria-label="Supprimer" data-testid="artifact-delete" onClick={async () => { if (await confirm({ title: 'Supprimer ce support ?', message: 'La transcription et vos notes ne sont pas modifiées.', confirmLabel: 'Supprimer', danger: true })) { await remove(art.id); navigate(session ? `/session/${session.id}/recap` : '/supports'); } }}><Trash2 /></button>
        </div>
      </header>

      <p className="artifact__prov muted no-print" data-testid="artifact-provenance">
        Créé à partir de la {sourceLabel}{session ? <> de <Link to={`/session/${session.id}/recap`} className="link">{session.title || 'la séance'}</Link></> : ''}
        {prov?.sourceLanguage && art.language !== prov.sourceLanguage ? ` · ${languageLabel(prov.sourceLanguage)} → ${languageLabel(art.language)}` : ''}
        {prov && prov.parts > 1 ? ` · ${prov.parts} parties traitées` : ''} · {art.generator?.local ? 'aucune donnée envoyée' : 'texte uniquement (jamais l’audio)'} · à vérifier
      </p>
      {busy && <p className="xprog muted no-print" role="status" aria-live="polite" data-testid="regenerate-progress">{progress ? `${progress.step}… ${Math.min(progress.done + 1, progress.total)}/${progress.total}` : 'Génération en cours…'}</p>}

      <div className="no-print doc-tools">
        {art.userEdited && art.generatedContent && (
          <button className="btn btn--sm btn--ghost" data-testid="restore-generated" onClick={async () => { if (await confirm({ title: 'Revenir à la version générée ?', message: 'Vos modifications seront remplacées par la dernière version générée.', confirmLabel: 'Revenir', danger: true })) { saver.current?.cancel(); await restoreGenerated(art.id); } }}><Undo2 /> Revenir à la version générée</button>
        )}
        {!!art.revisions?.length && (
          <button className="btn btn--sm btn--ghost" aria-expanded={history} onClick={() => setHistory((v) => !v)} data-testid="doc-history-toggle"><History /> Versions précédentes ({art.revisions.length})</button>
        )}
      </div>
      {history && !!art.revisions?.length && (
        <ul className="panel rows doc-history no-print" data-testid="doc-history">
          {art.revisions.map((r) => (
            <li key={`${r.generation}-${r.savedAt}`} className="row">
              <span className="row__main"><strong>Version {r.generation}{r.userEdited ? ' · modifiée par vous' : ' · générée'}</strong><span className="muted">{formatRelative(r.savedAt)}{r.generator ? ` · ${r.generator.local ? 'sur l’appareil' : r.generator.model}` : ''}</span></span>
              <button className="btn btn--sm" data-testid="doc-history-restore" onClick={async () => { saver.current?.flush(); await restoreRevision(art.id, r.generation); toast.success(`Version ${r.generation} restaurée ; la version actuelle est conservée.`); }}>Restaurer</button>
            </li>
          ))}
        </ul>
      )}

      <div className={`derived__body${showOriginal ? ' derived__body--split' : ''}`} ref={area}>
        <div className="print-area">
          <h1 className="print-only">{art.title}</h1>
          <DocView content={draft} onChange={change} editing={editing} onTime={onTime} />
          <p className="print-only print-foot">{FOOTER}</p>
        </div>
        {showOriginal && (
          <aside className="derived__original no-print" aria-label="Original" data-testid="doc-original-panel">
            <h2 className="section-title">Original <span className="muted">· {sourceLabel}</span></h2>
            {!original ? <p className="muted">Chargement…</p> : original.blocks.length ? <DocView content={original} onChange={() => undefined} editing={false} onTime={onTime} /> : <p className="muted">L’original n’est plus disponible sur cet appareil.</p>}
          </aside>
        )}
      </div>
      <ActionDialog request={req} onClose={() => setReq(null)} />
    </div>
  );
}
