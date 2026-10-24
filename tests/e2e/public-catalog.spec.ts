import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

test('Another account sees shared exercises in its list and builder, with private data excluded', async ({
  page,
  request,
  context,
}) => {
  test.skip(process.env.RUN_LIVE_TESTS !== 'yes', 'Explicit isolated live check');
  test.setTimeout(90000);
  const run = crypto.randomUUID(),
    created: string[] = [];
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const people = [];
    for (const label of ['publisher', 'reader']) {
      const email = `gymbrain-${label}-${run}@example.com`,
        password = crypto.randomUUID() + 'G!7a';
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { gymbrain_test_run: run },
      });
      if (error) throw error;
      created.push(data.user.id);
      const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const signed = await client.auth.signInWithPassword({ email, password });
      if (signed.error) throw signed.error;
      people.push({ email, password, token: signed.data.session!.access_token });
    }
    const [publisher, reader] = people;
    async function save(
      token: string,
      kind: string,
      payload: any,
      parentId: string | null = null,
      id = crypto.randomUUID(),
      baseVersion = 0,
    ) {
      const response = await request.post('/api/training/mutations', {
        headers: { Authorization: `Bearer ${token}` },
        data: { operationId: crypto.randomUUID(), id, kind, parentId, baseVersion, payload, deleted: false },
      });
      expect(response.status()).toBe(200);
      return id;
    }
    const name = `Shared pull ${run.slice(0, 8)}`;
    const payload = {
      name,
      description: 'Shared description',
      notes: 'OWNER PRIVATE NOTE',
      exerciseType: 'bodyweight',
      measurement: 'reps',
      variants: [
        {
          id: crypto.randomUUID(),
          name: 'Wide grip',
          notes: 'PRIVATE VARIANT NOTE',
          muscleTargets: { lats: 1 },
        },
      ],
      muscleTargets: { lats: 1, biceps: 0.5 },
      videoUrl: '',
      videoPath: '',
      isPublic: true,
    };
    const exerciseId = await save(publisher!.token, 'exercise', payload);
    const cycle = await save(reader!.token, 'cycle', {
      name: 'Test cycle',
      notes: '',
      start: new Date().toISOString().slice(0, 10),
      weeks: 4,
    });
    const plan = await save(reader!.token, 'plan', { name: 'Test plan', notes: '', order: 0 }, cycle);
    await save(reader!.token, 'workout', { name: 'Test day', notes: '', order: 0, exercises: [] }, plan);
    await page.goto('/');
    await page.getByLabel('Email', { exact: true }).fill(reader!.email);
    await page.getByLabel('Password', { exact: true }).fill(reader!.password);
    await page.getByRole('button', { name: 'Entra nel tuo spazio' }).click();
    await page.getByRole('button', { name: 'Esercizi', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Cerca esercizi', exact: true }).fill(name);
    const card = page.locator('.exercise-card').filter({ hasText: name });
    await expect(card).toContainText('Condiviso', { timeout: 20000 });
    await expect(card).toContainText('Wide grip');
    await expect(card.getByRole('button', { name: `Modifica ${name}`, exact: true })).toHaveCount(0);
    await expect(page.getByText('OWNER PRIVATE NOTE', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Percorso', exact: true }).click();
    await page.getByRole('button', { name: 'Apri builder scheda' }).click();
    await page.getByRole('button', { name: 'Aggiungi esercizio a Test day', exact: true }).click();
    await page.getByRole('button', { name: `Aggiungi ${name}`, exact: true }).click();
    await page.getByRole('button', { name: 'Wide grip', exact: true }).click();
    await page.getByRole('button', { name: 'Aggiungi alla scheda', exact: true }).click();
    const builder = page.getByRole('dialog', { name: 'BUILDER DELLA SCHEDA', exact: true });
    await expect(builder).toContainText(name);
    await builder.getByRole('button', { name: 'Chiudi', exact: true }).click();
    await page.getByRole('button', { name: 'Esercizi', exact: true }).click();
    await page.screenshot({ path: 'preview-artifacts/shared-catalog.png' });
    await context.setOffline(true);
    await page.reload();
    await page.getByRole('button', { name: 'Esercizi', exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await context.setOffline(false);
    await save(publisher!.token, 'exercise', { ...payload, isPublic: false }, null, exerciseId, 1);
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    await page.getByRole('button', { name: 'Sincronizza ora', exact: true }).click();
    await page.getByRole('button', { name: 'Esercizi', exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0, { timeout: 15000 });
  } finally {
    for (const id of created) {
      const checked = await admin.auth.admin.getUserById(id);
      if (checked.data.user?.app_metadata.gymbrain_test_run !== run)
        throw new Error('Cleanup owner mismatch');
      const removed = await admin.auth.admin.deleteUser(id);
      if (removed.error) throw removed.error;
    }
  }
});
