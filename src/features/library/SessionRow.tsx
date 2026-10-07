import { Link, useNavigate } from 'react-router-dom';
import { Check, ExternalLink, EyeOff, ImageIcon, MoreHorizontal, Trash2 } from 'lucide-react';
import type { CourseSession } from '@/domain/types';
import { sessionLabel } from '@/domain/session';
import { formatDateShort, formatRelative } from '@/lib/dates';
import { useLookups } from '@/lib/useLookups';
import { THUMBS, THUMB_KEYS, thumbFor } from '@/lib/thumbs';
import { useLibrary } from '@/store/library';
import { SubjectDot } from '@/components/SubjectDot';
import { Menu } from '@/components/Menu';
import { confirm } from '@/components/confirm';
import { toast } from '@/store/toasts';

interface Props {
  session: CourseSession;
  /** Masque la matière/module quand le contexte est déjà évident. */
  showContext?: boolean;
}

/** Ligne dense (≈ 70 px) : vignette · titre · matière › module · date · état · menu. */
export function SessionRow({ session: s, showContext = true }: Props) {
  const { subjectById, moduleById } = useLookups();
  const navigate = useNavigate();
  const { deleteSession, updateSession } = useLibrary();
  const subject = subjectById.get(s.subjectId);
  const mod = moduleById.get(s.moduleId);
  const done = s.status === 'completed';
  const href = done ? `/session/${s.id}/recap` : `/session/${s.id}`;
  const thumb = thumbFor(s, subject);

  async function remove() {
    const ok = await confirm({
      title: 'Supprimer ce séance ?',
      message: `« ${sessionLabel(s)} » et ses notes, transcription et audio seront définitivement supprimés de cet appareil.`,
      confirmLabel: 'Supprimer', danger: true,
    });
    if (!ok) return;
    try { await deleteSession(s.id); toast.success('Séance supprimé.'); } catch { /* toast déjà affiché */ }
  }

  return (
    <li className="srow" data-testid="session-row">
      <Link to={href} className="srow__main">
        <img className="srow__thumb" data-thumb={thumb} src={THUMBS[thumb].src} alt="" width={66} height={54} loading="lazy" />
        <span className="srow__text">
          <span className="srow__title truncate">{sessionLabel(s)}</span>
          <span className="srow__meta truncate">
            {showContext && subject && <><SubjectDot color={subject.color} /> {subject.name}{mod ? ` · ${mod.name}` : ''} · </>}
            {formatDateShort(s.date)}
            {s.wordCount > 0 ? <> · {s.wordCount.toLocaleString('fr-FR')} mots</> : <> · vide</>}
          </span>
        </span>
        <span className="srow__when">{formatRelative(s.updatedAt)}</span>
        <span className={`tag ${done ? 'tag--ok' : 'tag--live'}`}>{done ? 'Terminé' : 'En cours'}</span>
      </Link>
      <Menu trigger={(p) => (
        <button className="btn btn--ghost btn--icon btn--sm srow__more" {...p} aria-label={`Actions pour ${sessionLabel(s)}`} data-testid="row-menu"><MoreHorizontal /></button>
      )}>
        {(close) => (
          <>
            <button className="menu__item" role="menuitem" onClick={() => { close(); navigate(`/session/${s.id}`); }}><ExternalLink />Ouvrir dans l’éditeur</button>
            {done && <button className="menu__item" role="menuitem" onClick={() => { close(); navigate(`/session/${s.id}/recap`); }}><EyeOff />Voir le récapitulatif</button>}
            <div className="menu__sep" />
            <div className="menu__label"><ImageIcon size={12} style={{ verticalAlign: -1 }} /> Image</div>
            {THUMB_KEYS.map((k) => (
              <button key={k} className="menu__item" role="menuitem" onClick={() => { close(); void updateSession(s.id, { thumbnail: k }); }}>
                <img src={THUMBS[k].src} alt="" width={22} height={16} style={{ borderRadius: 3, objectFit: 'cover' }} />{THUMBS[k].label}{thumb === k && <Check style={{ marginLeft: 'auto' }} />}
              </button>
            ))}
            <div className="menu__sep" />
            <button className="menu__item menu__item--danger" role="menuitem" onClick={() => { close(); void remove(); }}><Trash2 />Supprimer</button>
          </>
        )}
      </Menu>
    </li>
  );
}
