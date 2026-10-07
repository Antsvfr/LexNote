/** Utilisateur authentifié (identité fournie par le service d'authentification, jamais saisie dans l'app). */
export interface AuthUser { id: string; email: string }

export interface Profile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string;
  institution: string;
  academicYear: string;
  usageType: string;
  onboardingCompleted: boolean;
}
export const emptyProfile = (u: AuthUser): Profile => ({
  id: u.id, email: u.email, firstName: '', lastName: '', avatarUrl: '', institution: '', academicYear: '', usageType: '', onboardingCompleted: false,
});

export type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'PASSWORD_RECOVERY' | 'TOKEN_REFRESHED' | 'INITIAL_SESSION';

/** Erreur d'authentification, déjà formulée en français pour l'interface. */
export class AuthError extends Error {
  constructor(message: string, readonly code: 'invalid_credentials' | 'email_taken' | 'weak_password' | 'not_confirmed' | 'network' | 'rate_limited' | 'unknown' = 'unknown') {
    super(message);
    this.name = 'AuthError';
  }
}

export interface SignUpResult {
  /** L'utilisateur doit confirmer son e-mail avant de pouvoir se connecter. */
  needsConfirmation: boolean;
  user: AuthUser | null;
}

/**
 * Contrat d'authentification. Aujourd'hui : e-mail + mot de passe.
 * Google / Apple / Microsoft / lien magique s'ajouteront ici (méthodes dédiées) sans toucher à l'interface.
 */
export interface AuthRepository {
  getSession(): Promise<{ user: AuthUser | null; offlineFallback: boolean }>;
  onAuthChange(cb: (event: AuthEvent, user: AuthUser | null) => void): () => void;
  signUp(email: string, password: string): Promise<SignUpResult>;
  signIn(email: string, password: string): Promise<AuthUser>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(newPassword: string): Promise<void>;
  /** Suppression définitive du compte : nécessite une fonction serveur (voir supabase/functions/delete-account). */
  deleteAccount(): Promise<void>;
  /** Jeton de session (pour appeler une fonction serveur du moteur de cours). */
  getAccessToken?(): Promise<string | null>;
}

export interface ProfileRepository {
  get(user: AuthUser): Promise<Profile>;
  update(user: AuthUser, patch: Partial<Omit<Profile, 'id' | 'email'>>): Promise<Profile>;
}
