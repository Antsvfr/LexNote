import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, LogOut, Menu as MenuIcon, Moon, Search, Settings, Sun, GraduationCap, HardDrive } from 'lucide-react';
import { Menu } from './Menu';
import { useUI } from '@/store/ui';
import { useAuth } from '@/store/auth';
import { estimateStorage, type StorageInfo } from '@/services/capture/quota';
import { formatBytes } from '@/domain/capture';
import { modKeyLabel } from '@/features/editor/commands';

/** Barre supérieure : recherche globale, thème, notifications, profil. */
export function AppHeader() {
  const navigate = useNavigate();
  const { theme, setTheme, setPalette, setNavOpen } = useUI();
  const profile = useAuth((s) => s.profile);
  const signOut = useAuth((s) => s.signOut);
  const firstName = profile?.firstName || profile?.email || '';
  const [q, setQ] = useState('');
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const initial = (firstName.trim()[0] ?? 'L').toUpperCase();
  const logout = async () => { await signOut(); navigate('/login', { replace: true }); };

  useEffect(() => { void estimateStorage().then(setInfo); }, []);
  const lowStorage = info?.level === 'low' || info?.level === 'critical';

  return (
    <header className="appheader">
      <button className="iconbtn appheader__menu" onClick={() => setNavOpen(true)} aria-label="Ouvrir la navigation"><MenuIcon size={20} /></button>

      <form className="searchbar" role="search" onSubmit={(e) => { e.preventDefault(); navigate(`/search?q=${encodeURIComponent(q)}`); }}>
        <Search size={18} aria-hidden />
        <input
          aria-label="Rechercher dans LexNote" data-testid="header-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher une matière, un CM, une note, un document..."
        />
        <button type="button" className="searchbar__kbd" onClick={() => setPalette(true)} aria-label="Ouvrir la palette de commandes" title="Palette de commandes">
          <kbd>{modKeyLabel} K</kbd>
        </button>
      </form>

      <div className="appheader__actions">
        <button className="iconbtn" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={dark ? 'Passer en thème clair' : 'Passer en thème sombre'} data-testid="theme-toggle" title="Thème">
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <Menu trigger={(p) => (
          <button className="iconbtn" {...p} aria-label="Notifications" title="Notifications">
            <Bell size={18} />{lowStorage && <span className="iconbtn__dot" aria-hidden />}
          </button>
        )}>
          {() => (
            <>
              <div className="menu__label">Notifications</div>
              {lowStorage && info ? (
                <button className="menu__item" role="menuitem" onClick={() => navigate('/settings')}><HardDrive />Stockage faible · {formatBytes(info.free)} disponibles</button>
              ) : (
                <div className="menu__label" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, padding: '8px 10px 10px' }}>Aucune notification.</div>
              )}
            </>
          )}
        </Menu>

        <Menu trigger={(p) => (
          <button className="avatarbtn" {...p} aria-label="Profil" data-testid="avatar">
            <span className="avatar" aria-hidden>{initial}</span><ChevronDown size={14} aria-hidden />
          </button>
        )}>
          {(close) => (
            <>
              <button className="menu__item" role="menuitem" onClick={() => { close(); navigate('/settings'); }}><Settings />Profil et réglages</button>
              <button className="menu__item" role="menuitem" onClick={() => { close(); setTheme(dark ? 'light' : 'dark'); }}>{dark ? <Sun /> : <Moon />}Thème {dark ? 'clair' : 'sombre'}</button>
              <div className="menu__sep" />
              <div className="menu__label" style={{ textTransform: 'none', letterSpacing: 0 }} data-testid="account-email">{profile?.email}</div>
              <button className="menu__item" role="menuitem" onClick={() => { close(); void logout(); }} data-testid="logout"><LogOut />Se déconnecter</button>
              <div className="menu__item" aria-disabled="true" style={{ cursor: 'default', opacity: 0.6 }}><GraduationCap />REV-EM · connexion bientôt disponible</div>
            </>
          )}
        </Menu>
      </div>
    </header>
  );
}
