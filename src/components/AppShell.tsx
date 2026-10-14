import { useEffect, useMemo } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Brain, Command, FolderTree, Home, Library, Plus, Search, Settings, X } from 'lucide-react';
import { LogoMark } from './Logo';
import { AppHeader } from './AppHeader';
import { SyncIndicator } from './SyncIndicator';
import { SubjectDot } from './SubjectDot';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { modKeyLabel } from '@/features/editor/commands';
import { GlobalRecPill } from '@/features/capture/RecControls';
import { useCreateSubject } from '@/features/library/useCreateSubject';
import { RevemCard } from '@/features/integration/RevemCard';

const navClass = ({ isActive }: { isActive: boolean }) => `nav__item${isActive ? ' is-active' : ''}`;

export function AppShell() {
  const subjects = useLibrary((s) => s.subjects);
  const sessions = useLibrary((s) => s.sessions);
  const persistent = useLibrary((s) => s.persistent);
  const { setPalette, navOpen, setNavOpen } = useUI();
  const createSubject = useCreateSubject();
  const { pathname } = useLocation();

  // Le tiroir (tablette/mobile) se referme à chaque navigation.
  useEffect(() => { setNavOpen(false); }, [pathname, setNavOpen]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    sessions.forEach((s) => m.set(s.subjectId, (m.get(s.subjectId) ?? 0) + 1));
    return m;
  }, [sessions]);
  const sorted = useMemo(() => [...subjects].sort((a, b) => a.name.localeCompare(b.name, 'fr')), [subjects]);

  return (
    <div className={`shell${navOpen ? ' nav-open' : ''}`}>
      <aside className="sidebar" aria-label="Navigation principale">
        <div className="brand">
          <LogoMark className="brand__mark" />
          <div className="brand__text"><strong>LexNote</strong><small>Notes · CM · Droit</small></div>
          <button className="iconbtn brand__close" onClick={() => setNavOpen(false)} aria-label="Fermer la navigation"><X size={18} /></button>
        </div>

        <nav className="nav" aria-label="Sections">
          <NavLink to="/" end className={navClass}><Home /> Accueil</NavLink>
          <NavLink to="/subjects" className={navClass}><FolderTree /> Mes matières</NavLink>
          <NavLink to="/sessions" className={navClass}><Library /> Mes séances</NavLink>
          <NavLink to="/supports" className={navClass} data-testid="nav-supports"><Brain /> Mes supports</NavLink>
          <NavLink to="/search" className={navClass}><Search /> Recherche</NavLink>
          <button className="nav__item" onClick={() => setPalette(true)} data-testid="nav-commands">
            <Command /> Commandes <kbd className="kbd-hint">{modKeyLabel} K</kbd>
          </button>
        </nav>

        <div className="sidebar__section">
          <div className="sidebar__title">
            Matières
            <button onClick={() => void createSubject()} aria-label="Nouvelle matière" title="Nouvelle matière" data-testid="sidebar-new-subject"><Plus size={16} /></button>
          </div>
          {sorted.length === 0 && <p className="muted" style={{ padding: '0 12px', fontSize: 13 }}>Aucune matière pour l’instant.</p>}
          {sorted.map((s) => (
            <NavLink key={s.id} to={`/subjects/${s.id}`} className={(p) => `${navClass(p)} subject-link`}>
              <SubjectDot color={s.color} icon={s.icon} />
              <span className="truncate">{s.name}</span>
              <span className="count">{counts.get(s.id) ?? 0}</span>
            </NavLink>
          ))}
        </div>

        <div className="sidebar__foot">
          <RevemCard />
          <SyncIndicator />
          <div className="sidebar__sync" title="Vos notes sont d’abord enregistrées sur cet appareil, puis synchronisées avec votre compte.">
            <span className={`status-dot${persistent ? '' : ' is-warn'}`} aria-hidden />
            {persistent ? 'Enregistré sur cet appareil' : 'Stockage temporaire !'}
          </div>
          <NavLink to="/settings" className={navClass}><Settings /> Réglages</NavLink>
        </div>
      </aside>
      <div className="scrim-nav" onClick={() => setNavOpen(false)} aria-hidden />

      <main className="main" id="main">
        <div className="main__inner">
          <div className="globalrec"><GlobalRecPill /></div>
          <AppHeader />
          <Outlet />
        </div>
      </main>

      <nav className="tabbar" aria-label="Navigation mobile">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'is-active' : '')}><Home />Accueil</NavLink>
        <NavLink to="/subjects" className={({ isActive }) => (isActive ? 'is-active' : '')}><FolderTree />Matières</NavLink>
        <NavLink to="/sessions" className={({ isActive }) => (isActive ? 'is-active' : '')}><Library />Séances</NavLink>
        <NavLink to="/search" className={({ isActive }) => (isActive ? 'is-active' : '')}><Search />Recherche</NavLink>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? 'is-active' : '')}><Settings />Réglages</NavLink>
      </nav>
    </div>
  );
}
