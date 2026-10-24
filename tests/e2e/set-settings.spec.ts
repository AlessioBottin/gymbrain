import { test, expect } from '@playwright/test';
test('Exercise rest, optional notes, direct technique choices and per-set band inheritance', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Prova sul dispositivo' }).click();
  await page.getByRole('button', { name: 'Usa percorso iniziale' }).click();
  await page.getByRole('button', { name: 'Percorso', exact: true }).click();
  await page.getByRole('button', { name: 'Apri builder scheda' }).click();
  const builder = page.getByRole('dialog', { name: 'BUILDER DELLA SCHEDA' });
  await builder.getByRole('button', { name: 'Aggiungi esercizio a Upper body', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'AGGIUNGI ESERCIZIO', exact: true })
    .getByRole('button', { name: 'Aggiungi Pull-up', exact: true })
    .click();
  const settings = page.getByRole('dialog', { name: 'IMPOSTA LE SERIE', exact: true });
  await settings.getByRole('spinbutton', { name: 'Numero di serie', exact: true }).fill('3');
  await settings.getByRole('spinbutton', { name: 'Numero di serie', exact: true }).press('Tab');
  await expect(
    settings.getByRole('spinbutton', { name: 'Recupero tra le serie (secondi)', exact: true }),
  ).toHaveCount(1);
  await settings.getByRole('spinbutton', { name: 'Recupero tra le serie (secondi)', exact: true }).fill('75');
  await expect(settings.getByLabel('Note esercizio')).toHaveCount(0);
  await settings.getByRole('button', { name: 'Aggiungi note' }).click();
  await settings.getByLabel('Note esercizio').fill('Controllo');
  const sets = settings.locator('.builder-set');
  await sets.nth(0).getByLabel('Sovraccarico (kg)').fill('10');
  await sets.nth(0).getByLabel('Sovraccarico (kg)').press('Tab');
  await expect(sets.nth(1).getByLabel('Sovraccarico (kg)')).toHaveValue('10');
  await settings.getByRole('button', { name: 'Elastico serie 1', exact: true }).click();
  const bandMenu = page.getByRole('dialog', { name: 'ELASTICO SERIE 1', exact: true });
  await bandMenu.getByRole('checkbox', { name: /GORNATION Ultra Light/ }).check();
  await bandMenu.getByRole('button', { name: 'Conferma', exact: true }).click();
  await expect(settings.getByRole('button', { name: 'Elastico serie 2', exact: true })).toContainText(
    'Ultra Light',
  );
  await sets.nth(0).getByText('Drop set', { exact: true }).click();
  await expect(sets.nth(0).getByRole('radio', { name: 'Drop set', exact: true })).toBeChecked();
  await sets.nth(0).getByText('Standard', { exact: true }).click();
  await settings.getByRole('button', { name: 'Aggiungi alla scheda' }).click();
  await builder.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await expect(builder).not.toBeVisible();
  await page.getByRole('button', { name: 'Apri builder scheda' }).click();
  await builder.locator('.builder-day').first().getByRole('button', { name: 'Modifica serie di Pull-up', exact: true }).last().click();
  await expect(
    settings.getByRole('spinbutton', { name: 'Recupero tra le serie (secondi)', exact: true }),
  ).toHaveValue('75');
  await expect(settings.getByRole('button', { name: 'Elastico serie 2', exact: true })).toContainText(
    'Ultra Light',
  );
  await page.screenshot({ path: 'preview-artifacts/set-settings.png' });
});
