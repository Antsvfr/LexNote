import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileText, FileType2, Image as ImageIcon, Loader2, Mic, NotebookPen, Presentation, RefreshCw, Trash2, UploadCloud } from 'lucide-react';
import type { DocumentStatus, SourceDocument } from '@/domain/course';
import type { CourseSession } from '@/domain/types';
import { useEngine } from '@/store/engine';
import { useCapture } from '@/store/capture';
import { confirm } from '@/components/confirm';
import { formatDuration, formatRelative } from '@/lib/dates';
import { ACCEPT_ATTR } from '@/services/engine/extractors';
import { highlightQuote } from './NotesTab';

const FORMAT_ICON = { pdf: FileText, pptx: Presentation, docx: FileType2, text: FileText, image: ImageIcon, other: FileText } as const;
const STATUS: Record<DocumentStatus, { label: string; cls: string }> = {
  pending: { label: 'En attente', cls: 'busy' }, processing: { label: 'Analyse…', cls: 'busy' }, ready: { label: 'Prêt', cls: 'ok' }, error: { label: 'Erreur', cls: 'err' }, unsupported: { label: 'Texte non exploitable', cls: 'warn' },
};
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

export function SourcesTab({ session, notesWords, docId, unit, quote }: { session: CourseSession; notesWords: number; docId: string | null; unit: number | null; quote: string | null }) {
  const { documents, importFiles, reanalyze, removeDocument } = useEngine();
  const docs = useMemo(() => documents.filter((d) => d.sessionId === session.id).sort((a, b) => a.addedAt.localeCompare(b.addedAt)), [documents, session.id]);
  const segments = useCapture((c) => c.segments); const captureLoaded = useCapture((c) => c.loaded);
  const [over, setOver] = useState(false);
  const [open, setOpen] = useState<string | null>(docId);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (docId) setOpen(docId); }, [docId]);
  const tMs = segments.length ? (segments[segments.length - 1]!.endMs - segments[0]!.startMs) : 0;
  const take = (files: FileList | File[] | null) => { const list = [...(files ?? [])]; if (list.length) void importFiles(session.id, list); };

  return (
    <div className="srcs-tab" data-testid="sources-tab">
      <div className="srcsum">
        <div className="srcsum__card"><NotebookPen size={18} aria-hidden /><div><strong>Notes</strong><span>{notesWords > 0 ? `${notesWords.toLocaleString('fr-FR')} mots` : 'vides'}</span></div><span className={`tag ${notesWords ? 'tag--ok' : ''}`}>{notesWords ? 'Source' : '—'}</span></div>
        <div className="srcsum__card"><Mic size={18} aria-hidden /><div><strong>Transcription</strong><span>{captureLoaded && segments.length ? `${segments.length} passages · ${formatDuration(tMs / 1000)}` : 'aucune'}</span></div><span className={`tag ${segments.length ? 'tag--ok' : ''}`}>{segments.length ? 'Source' : '—'}</span></div>
        <div className="srcsum__card"><FileText size={18} aria-hidden /><div><strong>Documents</strong><span>{docs.length ? `${docs.length} importé${docs.length > 1 ? 's' : ''}` : 'aucun'}</span></div><span className={`tag ${docs.some((d) => d.status === 'ready') ? 'tag--ok' : ''}`}>{docs.some((d) => d.status === 'ready') ? 'Source' : '—'}</span></div>
      </div>

      <div
        className={`dropzone${over ? ' is-over' : ''}`} data-testid="dropzone"
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
      >
        <UploadCloud size={26} aria-hidden />
        <p><strong>Glissez vos supports ici</strong> ou <button type="button" className="link" onClick={() => input.current?.click()} data-testid="pick-files">choisissez des fichiers</button></p>
        <small>PDF · PowerPoint (.pptx) · Word (.docx) · texte · images. Le fichier original reste sur cet appareil ; seul le texte analysé est synchronisé.</small>
        <input ref={input} type="file" multiple accept={ACCEPT_ATTR} hidden data-testid="file-input" onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
      </div>

      {docs.length === 0 ? <p className="muted srcs-tab__empty">Aucun document pour cette séance.</p> : (
        <ul className="doclist" data-testid="doc-list">
          {docs.map((d) => <DocRow key={d.id} d={d} open={open === d.id} onToggle={() => setOpen(open === d.id ? null : d.id)} unit={open === d.id ? unit : null} quote={quote}
            onReanalyze={() => void reanalyze(d.id)} onRemove={async () => { if (await confirm({ title: 'Supprimer ce document ?', message: `« ${d.name} » et son texte analysé seront supprimés. Vos notes et votre transcription ne sont pas modifiées ; les cours déjà reconstruits les gardent comme historique.`, confirmLabel: 'Supprimer', danger: true })) await removeDocument(d.id); }} />)}
        </ul>
      )}
    </div>
  );
}

function DocRow({ d, open, onToggle, onReanalyze, onRemove, unit, quote }: { d: SourceDocument; open: boolean; onToggle(): void; onReanalyze(): void; onRemove(): void; unit: number | null; quote: string | null }) {
  const Icon = FORMAT_ICON[d.format]; const st = STATUS[d.status];
  const word = d.unitLabel === 'slide' ? 'slide' : d.unitLabel === 'page' ? 'page' : 'section';
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open && quote) setTimeout(() => highlightQuote(body.current, quote), 120); }, [open, quote, unit]);
  return (
    <li className="docrow" data-testid="doc-row" data-status={d.status}>
      <div className="docrow__main">
        <Icon size={20} aria-hidden />
        <div className="docrow__text"><strong className="truncate">{d.name}</strong>
          <span className="muted">{d.format.toUpperCase()} · {kb(d.size)}{d.count ? ` · ${d.count} ${word}${d.count > 1 ? 's' : ''}` : ''}{d.status === 'ready' ? ` · ${d.wordCount.toLocaleString('fr-FR')} mots` : ''} · ajouté {formatRelative(d.addedAt)}</span></div>
        <span className={`syncind syncind--${st.cls}`} data-testid="doc-status">{d.status === 'processing' || d.status === 'pending' ? <Loader2 size={13} className="spin" /> : d.status === 'ready' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />} {st.label}</span>
        {d.status === 'ready' && <button className="btn btn--sm" onClick={onToggle} aria-expanded={open} data-testid="doc-view">{open ? 'Masquer' : 'Voir le texte'}</button>}
        <button className="btn btn--ghost btn--icon btn--sm" onClick={onReanalyze} aria-label={`Ré-analyser ${d.name}`} title="Ré-analyser depuis le fichier original" data-testid="doc-reanalyze"><RefreshCw /></button>
        <button className="btn btn--ghost btn--icon btn--sm" onClick={onRemove} aria-label={`Supprimer ${d.name}`} data-testid="doc-remove"><Trash2 /></button>
      </div>
      {d.error && <p className="docrow__err" role="note">{d.error}</p>}
      {open && d.extraction && (
        <div className="docview" ref={body} data-testid="doc-units">
          {d.extraction.units.map((u) => (
            <section key={u.index} className={`docview__unit${unit === u.index ? ' is-target' : ''}`} id={`unit-${d.id}-${u.index}`} data-unit={u.index}>
              <h4>{word.charAt(0).toUpperCase() + word.slice(1)} {u.index}{u.title ? ` — ${u.title}` : ''}</h4>
              <p>{u.text}</p>
            </section>
          ))}
        </div>
      )}
    </li>
  );
}
