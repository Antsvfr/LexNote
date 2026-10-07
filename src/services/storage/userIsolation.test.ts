import { describe, expect, it } from 'vitest';
import { createStorage } from './index';
import { createSubject } from '@/domain/session';

describe('isolation locale multi-utilisateur', () => {
  it('sépare les bases IndexedDB par userId', async () => {
    const a = await createStorage('user-a');
    const b = await createStorage('user-b');
    const sa = createSubject('Droit A', 'indigo');
    const sb = createSubject('Finance B', 'orange');

    await a.commit({ putSubjects: [sa] });
    await b.commit({ putSubjects: [sb] });

    expect((await a.loadLibrary()).subjects.map((s) => s.name)).toEqual(['Droit A']);
    expect((await b.loadLibrary()).subjects.map((s) => s.name)).toEqual(['Finance B']);
  });
});
