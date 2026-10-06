import { useEffect, useState } from 'react';
import { Download, Monitor, Moon, Sun, Trash2, Sparkles } from 'lucide-react';
import { useLibrary } from '@/store/library';
import { useUI, type ThemePref } from '@/store/ui';
import { hasDemoData } from '@/domain/demo';
import { confirm } from '@/components/confirm';
import { toast } from '@/store/toasts';
import { installDemo } from '@/data/seed';
import { getStorage } from '@/bootstrap';
import { captureManager } from '@/services/capture/manager';
import { TranscriptionSettings } from './TranscriptionSettings';
import { useProfile, DEFAULT_QUOTE } from '@/store/profile';

interface BeforeInstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

const THEMES: { id: ThemePref; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Clair', icon: Sun },
  { id: 'dark', label: 'Sombre', icon: Moon },
  { id: 'system', label: 'Système', icon: Monitor },
];

export function SettingsPage() {
  const { theme, setTheme } = useUI();
  const profile = useProfile();
  const lib = useLibrary();
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone] = useState(() => window.matchMedia('(display-mode: standalone)').matches);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<string>('');

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvt(e as BeforeInstallPromptEvent); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
    navigator.storage?.estimate?.().then((e) => e.usage != null && setUsage(`${(e.usage / 1024).toFixed(0)} Ko`)).catch(() => undefined);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, [lib.sessions.length]);

  async function exportJson() {
    try {
      const bundle = { ...(await lib.exportAll()), capture: await captureManager.exportAll().catch(() => []) };
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = `lexnote-export-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { toast.error('Export impossible.'); }
  }
  async function wipe() {
    const ok = await confirm({ title: 'Tout effacer ?', message: 'Toutes les matières, modules, CM et notes seront supprimés de cet appareil. Cette action est irréversible — pensez à exporter d’abord.', confirmLabel: 'Tout effacer', danger: true });
    if (ok) { await lib.wipe(); toast.success('Données effacées.'); }
  }
  async function restoreDemo() {
    await installDemo(getStorage()); await lib.reload(); toast.success('Données de démonstration installées.');
  }
  async function removeDemo() {
    const ok = await confirm({ title: 'Supprimer la démo ?', message: 'Seules les données de démonstration sont retirées ; vos propres notes sont conservées.', confirmLabel: 'Supprimer', danger: true });
    if (ok) { await lib.removeDemoData(); toast.success('Démo supprimée.'); }
  }

  return (
    <div className="page page-enter">
      <header className="page__head"><div><h1>Réglages</h1></div></header>

      <section className="settings-block" aria-labelledby="pr-h">
        <h2 id="pr-h">Profil</h2>
        <p className="muted">Enregistré uniquement sur cet appareil. Sert à personnaliser l’accueil.</p>
        <div className="field"><label htmlFor="fn">Prénom</label><input id="fn" className="input" value={profile.firstName} maxLength={40} onChange={(e) => profile.update({ firstName: e.target.value })} data-testid="profile-name" placeholder="ex. Anton" /></div>
        <div className="field"><label htmlFor="qt">Citation du bandeau d’accueil</label><input id="qt" className="input" value={profile.quote} maxLength={120} onChange={(e) => profile.update({ quote: e.target.value })} placeholder={DEFAULT_QUOTE} /></div>
      </section>

      <section className="settings-block">
        <h2>Apparence</h2>
        <div className="seg" role="radiogroup" aria-label="Thème">
          {THEMES.map(({ id, label, icon: Icon }) => (
            <button key={id} role="radio" aria-checked={theme === id} className={theme === id ? 'is-on' : ''} onClick={() => setTheme(id)}><Icon size={15} /> {label}</button>
          ))}
        </div>
      </section>

      <TranscriptionSettings />

      <section className="settings-block">
        <h2>Application</h2>
        <p className="muted">{standalone ? 'LexNote est installée et s’exécute comme une application indépendante.' : 'Installez LexNote pour l’ouvrir depuis le Dock comme une application.'}</p>
        {!standalone && (
          installEvt
            ? <button className="btn btn--primary" onClick={async () => { await installEvt.prompt(); setInstallEvt(null); }}>Installer LexNote</button>
            : <p className="muted" style={{ fontSize: 13 }}>Chrome / Edge : icône d’installation dans la barre d’adresse. Safari (macOS) : Fichier › Ajouter au Dock.</p>
        )}
      </section>

      <section className="settings-block">
        <h2>Données & confidentialité</h2>
        <p className="muted">
          Vos notes sont stockées <strong>uniquement sur cet appareil</strong> ({lib.storageKind === 'indexeddb' ? 'IndexedDB' : 'mémoire temporaire'}). Rien n’est envoyé sur Internet.
          {usage && <> Espace utilisé : {usage}.</>}
          {persisted === false && <> Le navigateur peut effacer ces données s’il manque d’espace ; exportez-les régulièrement.</>}
        </p>
        {!lib.persistent && <div className="banner banner--warn">Le stockage persistant est indisponible (navigation privée ?) : vos notes seront perdues à la fermeture.</div>}
        <div className="row-actions">
          <button className="btn" onClick={exportJson}><Download /> Exporter (JSON)</button>
          <span className="muted" style={{ fontSize: 12.5, alignSelf: 'center' }}>Notes, transcriptions, marqueurs (sans les fichiers audio).</span>
          <button className="btn btn--danger" onClick={wipe}><Trash2 /> Tout effacer</button>
        </div>
      </section>

      <section className="settings-block">
        <h2>Données de démonstration</h2>
        <p className="muted">Exemples fictifs (Droit, Économie…) pour explorer LexNote. Ils n’interfèrent pas avec vos données.</p>
        <div className="row-actions">
          {hasDemoData(lib)
            ? <button className="btn btn--danger" onClick={removeDemo}><Trash2 /> Supprimer la démo</button>
            : <button className="btn" onClick={restoreDemo}><Sparkles /> Réinstaller la démo</button>}
        </div>
      </section>

      <p className="muted" style={{ fontSize: 12.5 }}>LexNote v{__APP_VERSION__} · V1 « Fondation »</p>
    </div>
  );
}
