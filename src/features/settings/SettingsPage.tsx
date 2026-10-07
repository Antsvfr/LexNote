import { useEffect, useState } from 'react';
import { Download, LogOut, Monitor, Moon, Save, Sun, UserRound } from 'lucide-react';
import { useLibrary } from '@/store/library';
import { useUI, type ThemePref } from '@/store/ui';
import { toast } from '@/store/toasts';
import { captureManager } from '@/services/capture/manager';
import { TranscriptionSettings } from './TranscriptionSettings';
import { useAuth } from '@/store/auth';
import { useSyncStatus } from '@/store/sync';

interface BeforeInstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

const THEMES: { id: ThemePref; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Clair', icon: Sun },
  { id: 'dark', label: 'Sombre', icon: Moon },
  { id: 'system', label: 'Système', icon: Monitor },
];

export function SettingsPage() {
  const { theme, setTheme } = useUI();
  const lib = useLibrary();
  const auth = useAuth();
  const sync = useSyncStatus();
  const profile = auth.profile!;
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [institution, setInstitution] = useState(profile.institution);
  const [academicYear, setAcademicYear] = useState(profile.academicYear);
  const [quote, setQuote] = useState(profile.quote);
  const [saving, setSaving] = useState(false);
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone] = useState(() => window.matchMedia('(display-mode: standalone)').matches);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<string>('');

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvt(e as BeforeInstallPromptEvent); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
    navigator.storage?.estimate?.().then((e) => e.usage != null && setUsage((e.usage / 1024 / 1024).toFixed(1) + ' Mo')).catch(() => undefined);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, [lib.sessions.length]);

  async function saveProfile() {
    setSaving(true);
    try {
      await auth.updateProfile({ firstName, lastName, institution, academicYear, quote });
      toast.success('Profil mis à jour.');
    } catch {
      toast.error('Impossible de mettre à jour le profil.');
    } finally {
      setSaving(false);
    }
  }

  async function exportJson() {
    try {
      const bundle = { ...(await lib.exportAll()), capture: await captureManager.exportAll().catch(() => []) };
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'lexnote-export-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error('Export impossible.');
    }
  }

  return (
    <div className="page page-enter">
      <header className="page__head"><div><h1>Réglages</h1><p className="page__sub">Compte, synchronisation et préférences LexNote.</p></div></header>

      <section className="settings-block" aria-labelledby="account-h">
        <h2 id="account-h"><UserRound size={18} /> Compte</h2>
        <p className="muted">{profile.email}</p>
        <div className="auth-grid">
          <div className="field"><label>Prénom</label><input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
          <div className="field"><label>Nom</label><input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
        </div>
        <div className="auth-grid">
          <div className="field"><label>Établissement</label><input className="input" value={institution} onChange={(e) => setInstitution(e.target.value)} /></div>
          <div className="field"><label>Année / niveau</label><input className="input" value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} /></div>
        </div>
        <div className="field"><label>Citation du bandeau</label><input className="input" value={quote} maxLength={120} onChange={(e) => setQuote(e.target.value)} /></div>
        <div className="row-actions">
          <button className="btn btn--primary" onClick={() => void saveProfile()} disabled={saving}><Save /> {saving ? 'Enregistrement…' : 'Enregistrer'}</button>
          <button className="btn btn--danger" onClick={() => void auth.signOut()}><LogOut /> Se déconnecter</button>
        </div>
      </section>

      <section className="settings-block">
        <h2>Synchronisation</h2>
        <p className="muted">
          LexNote enregistre d’abord sur cet appareil, puis synchronise votre espace personnel avec Supabase.
          {sync.phase === 'offline' && ' Vous êtes hors ligne : les modifications seront envoyées automatiquement au retour de la connexion.'}
        </p>
        <div className="row-actions">
          <span className={'tag ' + (sync.phase === 'error' ? 'tag--live' : 'tag--ok')}>
            {sync.phase === 'syncing' ? 'Synchronisation…' : sync.phase === 'offline' ? 'Hors ligne' : sync.phase === 'error' ? 'Erreur de synchronisation' : 'Synchronisé'}
          </span>
          {sync.pending > 0 && <span className="muted">{sync.pending} modification{sync.pending > 1 ? 's' : ''} en attente</span>}
        </div>
        {sync.conflicts > 0 && (
          <div className="banner banner--warn" role="status">
            {sync.conflicts} conflit{sync.conflicts > 1 ? 's' : ''} de notes détecté{sync.conflicts > 1 ? 's' : ''}. Les deux versions ont été conservées localement afin d’éviter tout écrasement silencieux.
          </div>
        )}
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
        {!standalone && (installEvt
          ? <button className="btn btn--primary" onClick={async () => { await installEvt.prompt(); setInstallEvt(null); }}>Installer LexNote</button>
          : <p className="muted" style={{ fontSize: 13 }}>Chrome / Edge : icône d’installation dans la barre d’adresse. Safari : Fichier › Ajouter au Dock.</p>)}
      </section>

      <section className="settings-block">
        <h2>Données & confidentialité</h2>
        <p className="muted">
          Les notes restent disponibles localement ({lib.storageKind === 'indexeddb' ? 'IndexedDB' : 'mémoire temporaire'}) et sont synchronisées uniquement avec votre compte LexNote.
          {usage && <> Espace local utilisé : {usage}.</>}
          {persisted === false && <> Le navigateur peut évincer les données locales sous forte pression de stockage ; le cloud conserve les données déjà synchronisées.</>}
        </p>
        {!lib.persistent && <div className="banner banner--warn">Le stockage local persistant est indisponible. Restez connecté jusqu’à la fin de la synchronisation.</div>}
        <button className="btn" onClick={exportJson}><Download /> Exporter mes données (JSON)</button>
      </section>

      <p className="muted" style={{ fontSize: 12.5 }}>LexNote v{__APP_VERSION__} · espace multi-utilisateur</p>
    </div>
  );
}
