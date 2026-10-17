import { test, expect } from '@playwright/test';
test('Builder: personal targets, multiple days, volume, offline draft and multiple sessions', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Prova sul dispositivo' }).click();
  await page.getByRole('button', { name: 'Usa percorso iniziale' }).click();
  await page.getByRole('button', { name: 'Esercizi', exact: true }).click();
  await page.getByRole('button', { name: 'Nuovo esercizio' }).click();
  const editor = page.getByRole('dialog', { name: 'UN NUOVO INIZIO' });
  await editor.getByLabel('Nome', { exact: true }).fill('Push test');
  await editor.locator('.muscle-targets summary').click();
  await editor.getByRole('combobox', { name: 'Petto', exact: true }).selectOption('1');
  await editor.getByRole('combobox', { name: 'Tricipiti', exact: true }).selectOption('0.5');
  await editor.getByRole('button', { name: 'Salva sul dispositivo' }).click();
  await expect(editor).not.toBeVisible();
  await page.getByRole('button', { name: 'Percorso', exact: true }).click();
  await page.getByRole('button', { name: 'Apri builder scheda' }).click();
  const builder = page.getByRole('dialog', { name: 'BUILDER DELLA SCHEDA' });
  await builder.getByText('Aggiungi giornate', { exact: true }).click();
  await builder.getByRole('button', { name: '+ Lunedì', exact: true }).click();
  await builder.getByRole('button', { name: '+ Mercoledì', exact: true }).click();
  await builder
    .getByRole('combobox', { name: 'Esercizio', exact: true })
    .selectOption({ label: 'Push test' });
  await builder.getByRole('button', { name: 'Aggiungi alle giornate selezionate' }).click();
  const layout = await builder.evaluate((el) => {
    const days = [...el.querySelectorAll('.builder-day')].map((day) => day.getBoundingClientRect());
    return {
      tops: days.map((d) => d.top),
      lefts: days.map((d) => d.left),
      bottom: Math.max(...days.map((d) => d.bottom)),
      recapTop: el.querySelector('.builder-recap')!.getBoundingClientRect().top,
    };
  });
  expect(new Set(layout.tops).size).toBe(1);
  expect(layout.lefts.every((left, i, all) => i === 0 || left > all[i - 1]!)).toBe(true);
  expect(layout.recapTop).toBeGreaterThan(layout.bottom);
  const total = builder.locator('.volume-summary').first();
  await expect(
    total
      .locator('dl > div')
      .filter({ has: page.locator('dt', { hasText: /^Petto$/ }) })
      .locator('dd'),
  ).toHaveText('2');
  await expect(
    total
      .locator('dl > div')
      .filter({ has: page.locator('dt', { hasText: /^Tricipiti$/ }) })
      .locator('dd'),
  ).toHaveText('1');
  await builder.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await page.getByRole('button', { name: 'Apri builder scheda' }).click();
  await expect(builder.getByRole('heading', { name: /Push test/ })).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await builder.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await builder.locator('.builder-board').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  );
  await builder.getByRole('button', { name: 'Salva tutte le giornate' }).click();
  await expect(builder).not.toBeVisible();
  await page.getByLabel('Lunedì', { exact: true }).check();
  await page.getByLabel('Mercoledì', { exact: true }).check();
  await page.getByRole('button', { name: 'Avvia selezionati' }).click();
  const session = page.getByRole('dialog', { name: 'FOCUS MODE · IL TUO ALLENAMENTO', exact: true });
  await expect(session).toBeVisible();
  await session.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Riprendi: Lunedì', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Riprendi: Mercoledì', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Desktop overview and a cluster inside a superset guide execution and preserve parts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Prova sul dispositivo' }).click();
  await page.getByRole('button', { name: 'Usa percorso iniziale' }).click();
  await page.getByRole('button', { name: 'Percorso', exact: true }).click();
  await page.getByRole('button', { name: 'Apri builder scheda' }).click();
  const builder = page.getByRole('dialog', { name: 'BUILDER DELLA SCHEDA' });
  await expect(builder.locator('.builder-day')).toHaveCount(3);
  const bounds = await builder
    .locator('.builder-day')
    .evaluateAll((els) =>
      els.map((el) => ({ top: el.getBoundingClientRect().top, left: el.getBoundingClientRect().left })),
    );
  expect(bounds[0]!.top).toBe(bounds[2]!.top);
  expect(bounds[2]!.left).toBeGreaterThan(bounds[0]!.left);
  await expect(builder.getByRole('heading', { name: 'Recap scheda' })).toBeVisible();
  await page.screenshot({ path: 'preview-artifacts/builder-desktop.png' });
  const firstDay = builder.locator('.builder-day').first();
  const a = firstDay.locator('.builder-exercise').nth(0),
    b = firstDay.locator('.builder-exercise').nth(1);
  await a.getByLabel('Numero di serie').fill('1');
  await a.getByLabel('Numero di serie').press('Tab');
  await b.getByLabel('Numero di serie').fill('1');
  await b.getByLabel('Numero di serie').press('Tab');
  await a.getByText('Modifica esercizio e serie', { exact: true }).click();
  await a.getByLabel('Gruppo di esecuzione').selectOption('superset');
  const group = await a.getByLabel('Gruppo di esecuzione').inputValue();
  await b.getByText('Modifica esercizio e serie', { exact: true }).click();
  await b.getByLabel('Gruppo di esecuzione').selectOption(group);
  await a.getByLabel('Tecnica serie').selectOption('cluster');
  await expect(a.locator('.builder-prescription')).toContainText('1 × 6+6');
  await builder.getByRole('button', { name: 'Salva tutte le giornate' }).click();
  await expect(builder).not.toBeVisible();
  await page.getByRole('button', { name: 'Entra in allenamento' }).click();
  const session = page.getByRole('dialog', { name: 'FOCUS MODE · IL TUO ALLENAMENTO', exact: true });
  const cluster = session
    .locator('fieldset')
    .filter({ has: page.locator('legend', { hasText: 'Cluster set' }) });
  await cluster.getByLabel('Ripetizioni', { exact: true }).nth(0).fill('4');
  await cluster.getByRole('button', { name: 'Completa passaggio 1' }).click();
  await expect(session.locator('.timer')).toContainText(/0:(1[0-9]|20)/);
  await cluster.getByLabel('Ripetizioni', { exact: true }).nth(1).fill('4');
  await cluster.getByRole('button', { name: 'Completa passaggio 2' }).click();
  await expect(session.getByRole('heading', { name: 'Dip alle parallele' })).toBeVisible();
  await expect(session.locator('.timer')).toContainText('Nessuna pausa');
  await session.getByRole('textbox', { name: 'Serie 1 reps', exact: true }).fill('8');
  await session.getByRole('button', { name: 'Completa serie 1', exact: true }).click();
  await expect(session.locator('.timer')).toContainText(/1:00|0:5[0-9]/);
  await session.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Riprendi: Upper body', exact: true }).click();
  await session.getByRole('button', { name: /1. Pull-up/ }).click();
  await expect(cluster.getByLabel('Ripetizioni', { exact: true }).nth(0)).toHaveValue('4');
  await expect(session.getByRole('button', { name: 'Riapri serie 1', exact: true })).toBeVisible();
});
