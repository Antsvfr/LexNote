import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/newsreader/wght.css';
import '@fontsource-variable/newsreader/wght-italic.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/layout.css';
import './styles/pages.css';
import './styles/editor.css';
import './styles/capture.css';
import './styles/study.css';
import './styles/course.css';
import { App } from './App';
import { useAuth } from './store/auth';

// L'interface s'affiche tout de suite (écran de chargement) ; l'identité puis l'espace de l'utilisateur s'ouvrent ensuite.
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
void useAuth.getState().init().catch((err) => console.error('[LexNote] initialisation de l’authentification', err));
