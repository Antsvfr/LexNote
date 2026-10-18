import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GitCompare } from 'lucide-react';
import { useLibrary } from '@/store/library';
import { findConflictOriginal, isConflictCopy, type ConflictChoice } from '@/domain/conflict';
import { resolveConflict } from '@/services/conflictResolution';
import { confirm } from '@/components/confirm';
import { toast } from '@/store/toasts';
import { log } from '@/lib/log';
import type { CourseSession } from '@/domain/types';

/**
 * Affiché dans l'éditeur quand la séance ouverte est la copie issue d'un conflit de synchronisation (deux appareils ont modifié la même note).
 * L'étudiant choisit ; rien n'est supprimé sans son accord explicite.
 */
export function ConflictBanner({ session, flush }: { session: CourseSession; flush: () => Promise<unknown> }) {
  const sessions = useLibrary((s) => s.sessions);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!isConflictCopy(session)) return null;
  const original = findConflictOriginal(session, sessions);

  async function choose(choice: ConflictChoice) {
    if (!original && choice !== 'keep-both') return;
    if (choice === 'keep-this' && !await confirm({ title: 'Garder cette version ?', message: 'Les notes de cette version remplaceront celles de l’autre version, qui sera écrasée.', confirmLabel: 'Garder celle-ci', danger: true })) return;
    if (choice === 'keep-other' && !await confirm({ title: 'Garder l’autre version ?', message: 'Cette version (vos modifications locales) sera supprimée.', confirmLabel: 'Garder l’autre', danger: true })) return;
    setBusy(true);
    try {
      await flush();
      const st = useLibrary.getState();
      const next = await resolveConflict(choice, session, original ?? session, st);
      toast.success(choice === 'keep-both' ? 'Les deux versions sont conservées.' : 'Conflit résolu.');
      if (next !== session.id) navigate(`/session/${next}`, { replace: true });
    } catch (e) {
      log.sync.error('résolution du conflit', e, 'SYNC-CONFLICT-02');
      toast.error('Impossible de résoudre le conflit. Aucune version n’a été supprimée.');
    } finally { setBusy(false); }
  }

  return (
    <div className="banner banner--warn conflict-banner" role="alert" data-testid="conflict-banner">
      <GitCompare aria-hidden="true" />
      <div className="conflict-banner__text">
        <strong>Deux versions de cette note existent.</strong>
        <span> Elles ont été modifiées sur deux appareils{original ? '' : ' (l’autre version n’est plus disponible)'}. Choisissez celle à garder : rien n’est supprimé sans votre accord.</span>
      </div>
      <div className="conflict-banner__actions">
        <button className="btn" disabled={busy || !original} onClick={() => void choose('keep-this')} data-testid="conflict-keep-this">Garder celle-ci</button>
        <button className="btn" disabled={busy || !original} onClick={() => void choose('keep-other')} data-testid="conflict-keep-other">Garder l’autre</button>
        <button className="btn btn--primary" disabled={busy} onClick={() => void choose('keep-both')} data-testid="conflict-keep-both">Conserver les deux</button>
      </div>
    </div>
  );
}
