import { useEffect, useState } from 'react';
import { DatabaseBackup } from 'lucide-react';
import { detectLegacy, importLegacy, type LegacySummary } from '@/services/legacy/legacyImport';
import { getLocalAdapter, requestSync } from '@/services/workspace';
import { captureManager } from '@/services/capture/manager';
import { useAuth } from '@/store/auth';
import { useLibrary } from '@/store/library';
import { toast } from '@/store/toasts';

/** Anciennes notes (créées avant les comptes) : import EXPLICITE dans le compte courant, ou on ignore. */
export function LegacyImportBanner() {
  const userId = useAuth((s) => s.user?.id);
  const [found, setFound] = useState<LegacySummary | null>(null);
  const [busy, setBusy] = useState(false);
  const ignoreKey = userId ? `lexnote.legacyIgnored.${userId}` : '';

  useEffect(() => {
    let live = true;
    if (!userId) return;
    void detectLegacy().then((s) => { if (live && s && localStorage.getItem(ignoreKey) !== '1') setFound(s); });
    return () => { live = false; };
  }, [userId, ignoreKey]);

  if (!found || !userId) return null;

  async function doImport() {
    setBusy(true);
    try {
      await importLegacy(userId!, getLocalAdapter(), captureManager.getStorageOrNull());
      await useLibrary.getState().reload();
      requestSync(300);
      toast.success('Anciennes notes importées dans votre compte.');
      setFound(null);
    } catch (e) {
      console.error(e);
      toast.error('Import impossible. Vos anciennes notes n’ont pas été modifiées.');
      setBusy(false);
    }
  }

  return (
    <div className="banner dash__legacy" role="region" aria-label="Anciennes notes" data-testid="legacy-banner">
      <DatabaseBackup size={18} aria-hidden />
      <span>
        <strong>Nous avons trouvé des notes créées avant la création de votre compte</strong>
        {' '}({found.sessions} séance{found.sessions > 1 ? 's' : ''}, {found.subjects} matière{found.subjects > 1 ? 's' : ''}).
      </span>
      <span className="spacer" />
      <button className="btn btn--sm btn--primary" onClick={doImport} disabled={busy} data-testid="legacy-import">Importer dans mon compte</button>
      <button className="btn btn--sm" onClick={() => { localStorage.setItem(ignoreKey, '1'); setFound(null); }} disabled={busy} data-testid="legacy-ignore">Ignorer</button>
    </div>
  );
}
