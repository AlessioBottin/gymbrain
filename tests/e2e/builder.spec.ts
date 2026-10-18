import { test, expect } from '@playwright/test';
test.setTimeout(60000);
test('Builder: personal targets, multiple days, volume, offline draft and session', async ({ page }) => {
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
  await expect(editor.getByRole('combobox', { name: 'Petto', exact: true })).toHaveCount(0);
  await editor.getByRole('combobox', { name: 'Aggiungi gruppo muscolare' }).selectOption('chest');
  await editor.getByRole('combobox', { name: 'Aggiungi gruppo muscolare' }).selectOption('triceps');
  await editor.getByRole('combobox', { name: 'Tricipiti', exact: true }).selectOption('0');
  await expect(editor.getByRole('combobox', { name: 'Tricipiti', exact: true })).toHaveCount(0);
  await editor.getByRole('combobox', { name: 'Aggiungi gruppo muscolare' }).selectOption('triceps');
  await editor.getByRole('combobox', { name: 'Tricipiti', exact: true }).selectOption('0.5');
  await editor.getByRole('button', { name: 'Aggiungi variante +' }).click();
  await editor.getByLabel('Nome variante', { exact: true }).fill('Deep');
  await editor.getByRole('button', { name: 'Aggiungi variante +' }).click();
  await editor.getByLabel('Nome variante', { exact: true }).fill('Wide');
  await expect(editor.getByLabel('Nome variante', { exact: true })).toHaveCount(1);
  await editor
    .getByRole('combobox', { name: 'Variante da modificare', exact: true })
    .selectOption({ label: 'Deep' });
  await expect(editor.getByLabel('Nome variante', { exact: true })).toHaveValue('Deep');

  await editor.getByRole('button', { name: 'Salva sul dispositivo' }).click();
  await expect(editor).not.toBeVisible();
  await page.getByRole('button', { name: 'Percorso', exact: true }).click();
  await page.getByRole('button', { name: 'Apri builder scheda' }).click();
  const builder = page.getByRole('dialog', { name: 'BUILDER DELLA SCHEDA' });
  for (const name of ['Lunedì', 'Mercoledì']) {
    await builder.getByRole('button', { name: 'Aggiungi giornata', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'AGGIUNGI GIORNATA', exact: true })
      .getByRole('button', { name: '+ ' + name, exact: true })
      .click();
    await builder.getByRole('button', { name: 'Aggiungi esercizio a ' + name, exact: true }).click();
    await page
      .getByRole('dialog', { name: 'AGGIUNGI ESERCIZIO', exact: true })
      .getByRole('button', { name: 'Aggiungi Push test', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: 'SCEGLI LA VARIANTE', exact: true })
      .getByRole('button', { name: 'Standard', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: 'IMPOSTA LE SERIE', exact: true })
      .getByRole('button', { name: 'Aggiungi alla scheda' })
      .click();
  }
  await expect(builder.getByRole('button', { name: 'Salva tutte le giornate' })).toHaveCount(0);
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
  const addToUpper = builder.getByRole('button', { name: 'Aggiungi esercizio a Upper body', exact: true });
  await addToUpper.click();
  const picker = page.getByRole('dialog', { name: 'AGGIUNGI ESERCIZIO', exact: true });
  await expect(picker.getByRole('heading', { name: 'Upper body', exact: true })).toBeVisible();
  await picker.getByRole('searchbox', { name: 'Cerca esercizio' }).fill('non-esiste');
  await expect(picker.getByText('Nessun esercizio trovato.')).toBeVisible();
  await picker.getByRole('searchbox', { name: 'Cerca esercizio' }).fill('push');
  await expect(picker.locator('.builder-picker-item')).toHaveCount(1);
  await page.screenshot({ path: 'preview-artifacts/builder-exercise-picker.png' });
  await picker.getByRole('button', { name: 'Aggiungi Push test', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'SCEGLI LA VARIANTE', exact: true })
    .getByRole('button', { name: 'Deep', exact: true })
    .click();
  const settings = page.getByRole('dialog', { name: 'IMPOSTA LE SERIE', exact: true });
  await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: 'Aggiungi alla scheda' }).click();
  await expect(picker).not.toBeVisible();
  await expect(addToUpper).toBeFocused();
  const card = builder
    .locator('.builder-day')
    .first()
    .locator('.builder-exercise')
    .filter({ hasText: 'Push test' });
  await expect(card).toContainText('Deep');
  await card.getByRole('button', { name: 'Modifica serie di Push test' }).click();
  await settings.getByLabel('Numero di serie').fill('3');
  await settings.getByLabel('Numero di serie').press('Tab');
  await settings.getByRole('button', { name: 'Annulla', exact: true }).click();
  await expect(card.locator('.builder-prescription')).toContainText('1');
  await expect(builder.getByText('Organizza esercizio', { exact: true })).toHaveCount(0);
  await card.getByRole('button', { name: 'Modifica serie di Push test' }).click();
  await settings.getByRole('button', { name: "Sposta in un'altra giornata", exact: true }).click();
  const destination = page.getByRole('dialog', { name: 'SCEGLI LA GIORNATA', exact: true });
  await destination.getByRole('button', { name: 'Lower body', exact: true }).click();
  await settings.getByRole('button', { name: 'Annulla', exact: true }).click();
  await expect(card).toHaveCount(1);
  await card.getByRole('button', { name: 'Modifica serie di Push test' }).click();
  await settings.getByRole('button', { name: "Sposta in un'altra giornata", exact: true }).click();
  await destination.getByRole('button', { name: 'Lower body', exact: true }).click();
  await settings.getByRole('button', { name: 'Conferma modifiche' }).click();
  await expect(card).toHaveCount(0);
  const moved = builder
    .locator('.builder-day')
    .nth(1)
    .locator('.builder-exercise')
    .filter({ hasText: 'Push test' });
  await expect(moved).toContainText('Deep');
  await moved.getByRole('button', { name: 'Modifica serie di Push test' }).click();
  await settings.getByRole('button', { name: "Sposta in un'altra giornata", exact: true }).click();
  await destination.getByRole('button', { name: 'Upper body', exact: true }).click();
  await settings.getByRole('button', { name: 'Conferma modifiche' }).click();

  await expect(
    builder
      .locator('.builder-day')
      .first()
      .getByRole('heading', { name: /Push test/ }),
  ).toHaveCount(1);
  await expect(
    total
      .locator('dl > div')
      .filter({ has: page.locator('dt', { hasText: /^Petto$/ }) })
      .locator('dd'),
  ).toHaveText('3');
  await addToUpper.click();
  await page.keyboard.press('Escape');
  await expect(picker).not.toBeVisible();
  await expect(builder).toBeVisible();
  await builder.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await page.getByRole('button', { name: 'Apri builder scheda' }).click();
  await expect(builder.getByRole('heading', { name: /Push test/ })).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await builder.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await builder.locator('.builder-board').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  );
  await builder.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await expect(builder).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Avvia selezionati' })).toHaveCount(0);
  await page.locator('.days .day').filter({ hasText: 'Lunedì' }).click();
  await page.getByRole('button', { name: 'Entra in allenamento' }).click();
  const session = page.getByRole('dialog', { name: 'FOCUS MODE · IL TUO ALLENAMENTO', exact: true });
  await expect(session).toBeVisible();
  await session.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Riprendi: Lunedì', exact: true })).toBeVisible();
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
  await builder.getByRole('button', { name: 'Aggiungi esercizio a Upper body', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'AGGIUNGI ESERCIZIO', exact: true })
    .getByRole('button', { name: 'Aggiungi Squat', exact: true })
    .click();
  const newSettings = page.getByRole('dialog', { name: 'IMPOSTA LE SERIE', exact: true });
  await expect(newSettings).toBeVisible();
  await expect(newSettings.getByLabel('Variante', { exact: true })).toHaveCount(0);
  await newSettings.getByRole('button', { name: 'Annulla', exact: true }).click();
  const firstDay = builder.locator('.builder-day').first();
  const a = firstDay.locator('.builder-exercise').nth(0),
    b = firstDay.locator('.builder-exercise').nth(1);
  const settings = page.getByRole('dialog', { name: 'IMPOSTA LE SERIE', exact: true });
  await a.getByRole('button', { name: /Modifica serie/ }).click();
  await settings.getByLabel('Numero di serie').fill('1');
  await settings.getByLabel('Numero di serie').press('Tab');
  await settings.getByLabel('Gruppo di esecuzione').selectOption('superset');
  const group = await settings.getByLabel('Gruppo di esecuzione').inputValue();
  await settings.getByLabel('Tecnica serie').selectOption('cluster');
  await settings.getByRole('button', { name: 'Conferma modifiche' }).click();
  await b.getByRole('button', { name: /Modifica serie/ }).click();
  await settings.getByLabel('Numero di serie').fill('1');
  await settings.getByLabel('Numero di serie').press('Tab');
  await settings.getByLabel('Gruppo di esecuzione').selectOption(group);
  await settings.getByRole('button', { name: 'Conferma modifiche' }).click();
  await expect(a.locator('.builder-prescription')).toContainText('1 × 6+6');
  await builder.getByRole('button', { name: 'Chiudi', exact: true }).click();
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

test('Current mesocycle is displayed by default after reopening, with manual selection available', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Prova sul dispositivo' }).click();
  await page.getByRole('button', { name: 'Usa percorso iniziale' }).click();
  await page.getByRole('button', { name: 'Percorso', exact: true }).click();
  await page.getByRole('button', { name: 'Nuovo mesociclo +' }).click();
  const editor = page.getByRole('dialog', { name: 'UN NUOVO INIZIO' });
  await editor.getByLabel('Nome', { exact: true }).fill('Archivio passato');
  await editor.getByLabel('Data di inizio').fill('2020-01-01');
  await editor.getByLabel('Durata (settimane)').fill('1');
  await editor.getByRole('button', { name: 'Salva sul dispositivo' }).click();
  const select = page.getByRole('combobox', { name: 'Mesociclo', exact: true });
  await select.selectOption({ label: 'Archivio passato' });
  await expect(select.locator('option:checked')).toHaveText('Archivio passato');
  await page.reload();
  await expect(page.locator('.hero h2')).toHaveText('Forza, sotto controllo.');
  await page.getByRole('button', { name: 'Percorso', exact: true }).click();
  await expect(select.locator('option:checked')).toHaveText('Forza, sotto controllo.');
  await page.getByRole('button', { name: 'Nuova scheda', exact: true }).click();
  await editor.getByLabel('Nome', { exact: true }).fill('Scheda passata');
  await editor.getByLabel('Inizio periodo').fill('2020-01-01');
  await editor.getByLabel('Fine periodo').fill('2020-02-01');
  await editor.getByRole('button', { name: 'Salva sul dispositivo' }).click();
  await page.getByRole('button', { name: 'Seleziona scheda Scheda passata', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Percorso', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Seleziona scheda Accumulo', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.plan-card')).toHaveCount(2);
  await expect(page.locator('.plan-card h3')).toHaveText(['Scheda passata', 'Accumulo']);
  expect(
    await page
      .locator('.plan-card')
      .evaluateAll((cards) => cards.every((c) => c.getBoundingClientRect().width <= 361)),
  ).toBe(true);
  await page.screenshot({
    path: 'preview-artifacts/path-actions.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Rimuovi Pull-up dalla giornata', exact: true }).click();
  await expect(page.locator('.exercise-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Apri builder scheda' }).click();
  const builder = page.getByRole('dialog', { name: 'BUILDER DELLA SCHEDA' });
  await builder
    .locator('.builder-day')
    .first()
    .getByRole('button', { name: 'Rimuovi Dip alle parallele dalla giornata', exact: true })
    .click();
  await expect(builder.locator('.builder-day').first().locator('.builder-exercise')).toHaveCount(1);
  await builder.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await page.reload();
  await expect(page.locator('.exercise-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Esercizi', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pull-up', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dip alle parallele', exact: true })).toBeVisible();
});
