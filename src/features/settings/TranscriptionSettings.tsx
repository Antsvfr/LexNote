import { useEffect, useState } from 'react';
import { HardDrive, Trash2 } from 'lucide-react';
import { PLANNED_PROVIDERS, describeProviders } from '@/services/transcription';
import { loadEngineSettings, resetRecordingConsent, saveEngineSettings, type EngineSettings } from '@/services/transcription/settings';
import { captureManager } from '@/services/capture/manager';
import { estimateStorage, type StorageInfo } from '@/services/capture/quota';
import { formatBytes } from '@/domain/capture';
import { sessionLabel } from '@/domain/session';
import { useLibrary } from '@/store/library';
import { confirm } from '@/components/confirm';
import { toast } from '@/store/toasts';

/** Réglages du moteur de transcription et gestion de l'espace audio. */
export function TranscriptionSettings() {
  const [s, setS] = useState<EngineSettings>(loadEngineSettings);
  const update = (patch: Partial<EngineSettings>) => setS(saveEngineSettings(patch));
  const providers = describeProviders();
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const sessions = useLibrary((l) => l.sessions);

  const refresh = () => {
    void estimateStorage().then(setInfo);
    void captureManager.getStorage().audioUsage().then(setUsage).catch(() => setUsage({}));
  };
  useEffect(refresh, []);

  const total = Object.values(usage).reduce((a, b) => a + b, 0);
  const rows = sessions.filter((x) => usage[x.id]).sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0));

  async function removeAudio(id: string, label: string) {
    const ok = await confirm({ title: 'Supprimer l’audio de ce CM ?', message: `L’audio de « ${label} » sera supprimé de cet appareil. La transcription, les marqueurs et les notes sont conservés.`, confirmLabel: 'Supprimer l’audio', danger: true });
    if (!ok) return;
    await captureManager.deleteAudio(id);
    toast.success('Audio supprimé.');
    refresh();
  }

  return (
    <>
      <section className="settings-block" aria-labelledby="tr-h">
        <h2 id="tr-h">Transcription</h2>
        <div className="field">
          <label htmlFor="engine">Moteur</label>
          <select id="engine" className="select" value={s.providerId} onChange={(e) => update({ providerId: e.target.value })} data-testid="engine-select">
            <option value="auto">Automatique (premier disponible)</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.label}{p.availability.available ? '' : ' — indisponible'}</option>)}
            <option value="none">Aucun (audio seul)</option>
          </select>
        </div>
        <ul className="engine-list">
          {providers.map((p) => (
            <li key={p.id}>
              <strong>{p.label}</strong> <span className={`tag ${p.availability.available ? 'tag--ok' : ''}`}>{p.availability.available ? 'Disponible' : 'Indisponible'}</span>
              <p className="muted">{p.availability.available ? p.privacyNote : p.availability.reason}</p>
            </li>
          ))}
          {PLANNED_PROVIDERS.map((p) => (
            <li key={p.id}><strong>{p.label}</strong> <span className="tag tag--soon">Prévu</span><p className="muted">Transcription 100 % locale dans le navigateur. Non implémenté dans cette version.</p></li>
          ))}
        </ul>

        <div className="field">
          <label htmlFor="lang">Langue du cours</label>
          <select id="lang" className="select" value={s.language} onChange={(e) => update({ language: e.target.value })}>
            <option value="fr-FR">Français (France)</option><option value="fr-BE">Français (Belgique)</option><option value="fr-CH">Français (Suisse)</option>
            <option value="fr-CA">Français (Canada)</option><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option>
          </select>
        </div>
        <label className="check"><input type="checkbox" checked={s.keepAudio} onChange={(e) => update({ keepAudio: e.target.checked })} /> Conserver l’audio sur cet appareil (permet la réécoute)</label>

        <details className="engine-config">
          <summary>API Whisper compatible OpenAI / serveur local</summary>
          <p className="muted">Pour l’API OpenAI, saisissez <code>https://api.openai.com/v1</code> et votre propre clé. Pour un serveur Whisper local (whisper.cpp, faster-whisper-server…), indiquez son adresse : l’audio ne quitte alors pas votre Mac. La clé n’est stockée que dans ce navigateur.</p>
          <div className="field"><label htmlFor="base">Adresse de l’API</label><input id="base" className="input" placeholder="ex. http://localhost:8080/v1" value={s.baseUrl} onChange={(e) => update({ baseUrl: e.target.value })} data-testid="base-url" /></div>
          <div className="field"><label htmlFor="key">Clé d’API (facultative en local)</label><input id="key" className="input" type="password" autoComplete="off" value={s.apiKey} onChange={(e) => update({ apiKey: e.target.value })} data-testid="api-key" /></div>
          <div className="field"><label htmlFor="model">Modèle</label><input id="model" className="input" value={s.model} onChange={(e) => update({ model: e.target.value })} /></div>
        </details>
        <div className="row-actions"><button className="btn btn--sm" onClick={() => { resetRecordingConsent(); toast.success('L’avertissement sera de nouveau affiché au prochain enregistrement.'); }}>Réafficher l’avertissement d’enregistrement</button></div>
      </section>

      <section className="settings-block" aria-labelledby="st-h">
        <h2 id="st-h"><HardDrive size={16} aria-hidden /> Stockage audio</h2>
        <p className="muted" data-testid="settings-storage">
          Audio enregistré : <strong>{formatBytes(total)}</strong>
          {info && info.level !== 'unknown' && <> · Espace disponible : <strong>{formatBytes(info.free)}</strong> sur {formatBytes(info.quota)}</>}
          {info?.persisted === false && <> · Stockage non protégé : le navigateur peut l’effacer s’il manque d’espace.</>}
          {info?.persisted === true && <> · Stockage persistant accordé.</>}
        </p>
        {rows.length === 0 ? <p className="muted">Aucun audio enregistré.</p> : (
          <ul className="list">
            {rows.map((c) => (
              <li key={c.id} className="srow"><div className="srow__main"><span className="srow__text"><span className="srow__title">{sessionLabel(c)}</span><span className="srow__meta">{formatBytes(usage[c.id] ?? 0)}</span></span></div>
                <button className="btn btn--ghost btn--sm" onClick={() => void removeAudio(c.id, sessionLabel(c))}><Trash2 /> Supprimer l’audio</button></li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
