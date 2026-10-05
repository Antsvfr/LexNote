import { Link } from 'react-router-dom';
import { CheckCircle2, PenLine, Trash2 } from 'lucide-react';
import type { CourseSession } from '@/domain/types';
import { sessionLabel } from '@/domain/session';
import { formatDateShort, formatRelative } from '@/lib/dates';
import { useLookups } from '@/lib/useLookups';
import { useLibrary } from '@/store/library';
import { SubjectDot } from '@/components/SubjectDot';
import { confirm } from '@/components/confirm';
import { toast } from '@/store/toasts';

interface Props {
  session: CourseSession;
  /** Masque la matière/module quand le contexte est déjà évident. */
  showContext?: boolean;
}

export function SessionRow({ session: s, showContext = true }: Props) {
  const { subjectById, moduleById } = useLookups();
  const deleteSession = useLibrary((st) => st.deleteSession);
  const subject = subjectById.get(s.subjectId);
  const mod = moduleById.get(s.moduleId);
  const done = s.status === 'completed';

  async function remove() {
    const ok = await confirm({
      title: 'Supprimer ce CM ?',
      message: `« ${sessionLabel(s)} » et ses notes seront définitivement supprimés de cet appareil.`,
      confirmLabel: 'Supprimer', danger: true,
    });
    if (!ok) return;
    try { await deleteSession(s.id); toast.success('CM supprimé.'); } catch { /* toast déjà affiché */ }
  }

  return (
    <li className="srow" data-testid="session-row">
      <Link to={done ? `/session/${s.id}/recap` : `/session/${s.id}`} className="srow__main">
        <span className="srow__icon" aria-hidden>{done ? <CheckCircle2 size={16} /> : <PenLine size={16} />}</span>
        <span className="srow__text">
          <span className="srow__title truncate">{sessionLabel(s)}</span>
          <span className="srow__meta truncate">
            {showContext && subject && <><SubjectDot color={subject.color} /> {subject.name} › {mod?.name ?? '—'} · </>}
            {formatDateShort(s.date)}
            {s.wordCount > 0 && <> · {s.wordCount.toLocaleString('fr-FR')} mots</>}
            {!s.wordCount && <> · vide</>}
          </span>
        </span>
        <span className="srow__when muted">{formatRelative(s.updatedAt)}</span>
        <span className={`tag ${done ? 'tag--ok' : ''}`}>{done ? 'Terminé' : 'En cours'}</span>
      </Link>
      <button className="btn btn--ghost btn--icon btn--sm srow__del" onClick={remove} aria-label={`Supprimer ${sessionLabel(s)}`} title="Supprimer">
        <Trash2 />
      </button>
    </li>
  );
}
