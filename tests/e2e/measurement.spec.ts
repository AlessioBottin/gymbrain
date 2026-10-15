import { test, expect } from '@playwright/test';

test('One recorded set completes a workout; blank sets are excluded and zero is rejected', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Prova sul dispositivo' }).click();
  await page.getByRole('button', { name: 'Usa percorso iniziale' }).click();
  await page.getByRole('button', { name: /Entra in allenamento/ }).click();
  const session = page.getByRole('dialog', { name: /FOCUS MODE/ });
  const reps = session.getByRole('textbox', { name: 'Serie 1 reps', exact: true });
  await reps.fill('0');
  await session.getByRole('button', { name: 'Completa serie 1', exact: true }).click();
  await expect(session.getByRole('button', { name: 'Riapri serie 1', exact: true })).toHaveCount(0);
  await reps.fill('5');
  await session.getByRole('button', { name: 'Completa serie 1', exact: true }).click();
  await expect(session.getByText('Salvato sul dispositivo', { exact: true })).toBeVisible();
  await session.getByRole('button', { name: 'Concludi' }).click();
  const confirmation = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('button', { name: 'Salva allenamento' }) });
  await expect(confirmation).toContainText('1 serie completate su 9');
  await confirmation.getByRole('button', { name: 'Salva allenamento' }).click();
  await expect(session).not.toBeVisible();
});

test('An isometric exercise is prescribed and recorded in seconds', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Prova sul dispositivo' }).click();
  await page.getByRole('button', { name: 'Usa percorso iniziale' }).click();
  await page.getByRole('button', { name: 'Esercizi', exact: true }).click();
  await page.getByRole('button', { name: 'Nuovo esercizio' }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('Nome', { exact: true }).fill('Plank');
  await editor.getByLabel('Modalità di esecuzione').selectOption('duration');
  await editor.getByRole('button', { name: 'Salva sul dispositivo' }).click();
  await expect(editor).not.toBeVisible();
  await page.getByRole('button', { name: 'Percorso', exact: true }).click();
  await page.getByRole('button', { name: 'Modifica giornata' }).click();
  await editor.getByLabel('Aggiungi dal tuo catalogo').selectOption({ label: 'Plank' });
  await editor.getByRole('button', { name: 'Aggiungi +', exact: true }).click();
  await expect(editor.getByLabel('Plank serie 1 target tut', { exact: true })).toHaveValue('30');
  await editor.getByRole('button', { name: 'Salva sul dispositivo' }).click();
  await expect(editor).not.toBeVisible();
  await page.getByRole('button', { name: 'Oggi', exact: true }).click();
  await page.getByRole('button', { name: /Entra in allenamento/ }).click();
  const session = page.getByRole('dialog', { name: /FOCUS MODE/ });
  await session.getByRole('button', { name: /4\. Plank/ }).click();
  await expect(session.getByRole('textbox', { name: 'Serie 1 reps', exact: true })).toHaveCount(0);
  await session.getByRole('textbox', { name: 'Serie 1 tut', exact: true }).fill('25');
  await session.getByRole('button', { name: 'Completa serie 1', exact: true }).click();
  await expect(session.getByRole('button', { name: 'Riapri serie 1', exact: true })).toBeVisible();
});
