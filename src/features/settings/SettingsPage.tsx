import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, LogOut, Monitor, Moon, Sun, Trash2, UserX } from 'lucide-react';
import { useLibrary } from '@/store/library';
import { useUI, type ThemePref } from '@/store/ui';
import { useAuth } from '@/store/auth';
import { confirm, promptText } from '@/components/confirm';
import { toast } from '@/store/toasts';
import { captureManager } from '@/services/capture/manager';
import { SyncIndicator } from '@/components/SyncIndicator';
import { TranscriptionSettings } from './TranscriptionSettings';

interface BeforeInstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

const THEMES: { id: ThemePref; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Clair', icon: Sun },
  { id: 'dark', label: 'Sombre', icon: Moon },
  { id: 'system', label: 'Système', icon: Monitor },
];

export function SettingsPage() {
  const navigate = useNavigate();
  const { theme, setTheme } = useUI();
  const { profile, updateProfile, signOut, updatePassword, deleteAccount, backendKind } = useAuth();
  const lib = useLibrary();
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone] = useState(() => window.matchMedia('(display-mode: standalone)').matches);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<string>('');
  const [form, setForm] = useState({ firstName: profile?.firstName ?? '', lastName: profile?.lastName ?? '', institution: profile?.institution ?? '', academicYear: profile?.academicYear ?? '' });
  const [pw, setPw] = useState('');

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvt(e as BeforeInstallPromptEvent); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
    navigator.storage?.estimate?.().then((e) => e.usage != null && setUsage(`${(e.usage / 1024).toFixed(0)} Ko`)).catch(() => undefined);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, [lib.sessions.length]);

  async function saveProfile() {
    try { await updateProfile(form); toast.success('Profil enregistré.'); } catch (e) { toast.error((e as Error).message || 'Profil non enregistré.'); }
  }
  async function changePassword() {
    try { await updatePassword(pw); setPw(''); toast.success('Mot de passe modifié.'); } catch (e) { toast.error((e as Error).message || 'Modification impossible.'); }
  }
  async function logout() { await signOut(); navigate('/login', { replace: true }); }
  async function removeAccount() {
    const ok = await confirm({ title: 'Supprimer votre compte ?', message: 'Votre compte, toutes vos matières, séances, notes et transcriptions synchronisées seront définitivement supprimés du cloud, et les données de cet appareil effacées. Cette action est irréversible.', confirmLabel: 'Continuer', danger: true });
    if (!ok) return;
    const typed = await promptText({ title: 'Confirmation', label: 'Saisissez SUPPRIMER pour confirmer', placeholder: 'SUPPRIMER', confirmLabel: 'Supprimer mon compte' });
    if (typed?.trim() !== 'SUPPRIMER') { if (typed !== null) toast.error('Confirmation incorrecte : rien n’a été supprimé.'); return; }
    try { await deleteAccount(); navigate('/login', { replace: true }); toast.success('Compte supprimé.'); } catch (e) { toast.error((e as Error).message || 'Suppression impossible.'); }
  }

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
    const ok = await confirm({ title: 'Supprimer toutes mes séances ?', message: 'Toutes les matières, modules, séances et notes de votre compte seront supprimés (sur cet appareil et dans votre cloud). Votre compte reste ouvert. Cette action est irréversible — pensez à exporter d’abord.', confirmLabel: 'Tout supprimer', danger: true });
    if (ok) { await lib.wipe(); toast.success('Données supprimées.'); }
  }

  return (
    <div className="page page-enter">
      <header className="page__head"><div><h1>Réglages</h1></div></header>

      <section className="settings-block" aria-labelledby="acc-h" data-testid="account-section">
        <h2 id="acc-h">Compte</h2>
        <p className="muted">Connecté en tant que <strong data-testid="account-email-settings">{profile?.email}</strong>. <SyncIndicator /></p>
        <div className="row2">
          <div className="field"><label htmlFor="fn">Prénom</label><input id="fn" className="input" value={form.firstName} maxLength={60} onChange={(e) => setForm({ ...form, firstName: e.target.value })} data-testid="profile-name" /></div>
          <div className="field"><label htmlFor="ln">Nom</label><input id="ln" className="input" value={form.lastName} maxLength={60} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></div>
        </div>
        <div className="row2">
          <div className="field"><label htmlFor="inst">Établissement</label><input id="inst" className="input" value={form.institution} maxLength={120} onChange={(e) => setForm({ ...form, institution: e.target.value })} /></div>
          <div className="field"><label htmlFor="yr">Année / niveau</label><input id="yr" className="input" value={form.academicYear} maxLength={60} onChange={(e) => setForm({ ...form, academicYear: e.target.value })} /></div>
        </div>
        <div className="row-actions">
          <button className="btn btn--primary" onClick={saveProfile} data-testid="profile-save">Enregistrer le profil</button>
        </div>
        {backendKind !== 'unconfigured' && (
          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="npw">Nouveau mot de passe</label>
            <div className="row-actions">
              <input id="npw" type="password" autoComplete="new-password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} />
              <button className="btn" onClick={changePassword} disabled={pw.length < 8}>Modifier</button>
            </div>
          </div>
        )}
        <div className="row-actions" style={{ marginTop: 14 }}>
          <button className="btn" onClick={logout} data-testid="settings-logout"><LogOut /> Se déconnecter</button>
          <button className="btn btn--danger" onClick={removeAccount} data-testid="delete-account"><UserX /> Supprimer mon compte</button>
        </div>
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
          Vos notes sont enregistrées sur cet appareil ({lib.storageKind === 'indexeddb' ? 'IndexedDB' : 'mémoire temporaire'}) puis synchronisées avec <strong>votre espace personnel</strong> : personne d’autre n’y a accès. Les fichiers audio restent sur cet appareil.
          {usage && <> Espace utilisé : {usage}.</>}
          {persisted === false && <> Le navigateur peut effacer ces données s’il manque d’espace ; exportez-les régulièrement.</>}
        </p>
        {!lib.persistent && <div className="banner banner--warn">Le stockage persistant est indisponible (navigation privée ?) : vos notes seront perdues à la fermeture.</div>}
        <div className="row-actions">
          <button className="btn" onClick={exportJson}><Download /> Exporter (JSON)</button>
          <span className="muted" style={{ fontSize: 12.5, alignSelf: 'center' }}>Notes, transcriptions, marqueurs (sans les fichiers audio).</span>
          <button className="btn btn--danger" onClick={wipe} data-testid="wipe-all"><Trash2 /> Tout supprimer</button>
        </div>
      </section>

      <p className="muted" style={{ fontSize: 12.5 }}>LexNote v{__APP_VERSION__}</p>
    </div>
  );
}
