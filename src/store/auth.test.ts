import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_BACKEND', 'mock');

describe('comptes et espaces personnels (backend simulé)', () => {
  let useAuth: typeof import('./auth').useAuth;
  let useLibrary: typeof import('./library').useLibrary;
  beforeAll(async () => {
    ({ useAuth } = await import('./auth'));
    ({ useLibrary } = await import('./library'));
    await useAuth.getState().init();
  });
  const names = () => useLibrary.getState().subjects.map((s) => s.name);

  it('démarre sans session, espace vide, aucune donnée fictive', () => {
    expect(useAuth.getState().status).toBe('unauthenticated');
    expect(names()).toEqual([]);
  });

  it('mauvais mot de passe : message clair, aucun espace ouvert', async () => {
    await expect(useAuth.getState().signIn('inconnu@example.com', 'x')).rejects.toThrow(/incorrect/);
    expect(useAuth.getState().workspace).toBe('closed');
  });

  it('deux comptes sur le même navigateur : chacun ne voit QUE ses données, aucune fuite à la déconnexion', async () => {
    const a = useAuth.getState();
    await a.signUp('alice@example.com', 'motdepasse1');
    expect(useAuth.getState().workspace).toBe('ready');
    await useLibrary.getState().addSubject({ name: 'Droit d’Alice' });
    expect(names()).toEqual(['Droit d’Alice']);

    await useAuth.getState().signOut();
    expect(useAuth.getState().status).toBe('unauthenticated');
    expect(names()).toEqual([]);
    expect(useLibrary.getState().userId).toBeNull();

    await useAuth.getState().signUp('bob@example.com', 'motdepasse2');
    expect(names()).toEqual([]);
    await useLibrary.getState().addSubject({ name: 'Économie de Bob' });
    await useAuth.getState().signOut();

    await useAuth.getState().signIn('alice@example.com', 'motdepasse1');
    expect(names()).toEqual(['Droit d’Alice']);
    expect(JSON.stringify(useLibrary.getState())).not.toContain('Bob');
    await useAuth.getState().signOut();
  });

  it('mot de passe trop court refusé', async () => {
    await expect(useAuth.getState().signUp('court@example.com', '123')).rejects.toThrow();
  });
});
