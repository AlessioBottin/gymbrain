import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'

test('PWA updates automatically across tabs, defers workout reload and retains offline data', async ({
  page,
  context,
}) => {
  test.setTimeout(90000)
  // Two deployments of the real generated worker, with distinct HTML and precache revisions.
  const root = resolve('.output/public')
  const originalHtml = await readFile(resolve(root, 'index.html'), 'utf8')
  const originalSW = await readFile(resolve(root, 'sw.js'), 'utf8')
  expect(originalSW).toMatch(/url:"\/",revision:"[^"]+"/)
  let release = 'one'
  const mime: Record<string, string> = {
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
  }
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url!, 'http://localhost').pathname
      res.setHeader('Cache-Control', 'no-store')
      if (path === '/' || path === '/index.html') {
        res.setHeader('Content-Type', 'text/html')
        res.end(
          originalHtml.replace('</head>', `<meta name="test-release" content="${release}"></head>`),
        )
      } else if (path === '/sw.js') {
        res.setHeader('Content-Type', 'text/javascript')
        res.end(
          originalSW.replace(/url:"\/",revision:"[^"]+"/, `url:"/",revision:"release-${release}"`),
        )
      } else {
        const file = resolve(root, '.' + (['/200', '/404'].includes(path) ? path + '.html' : path))
        if (!file.startsWith(root + '\\') && !file.startsWith(root + '/')) {
          res.writeHead(403).end()
          return
        }
        res.setHeader('Content-Type', mime[extname(path)] || 'text/html')
        res.end(await readFile(file))
      }
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const url = `http://127.0.0.1:${(server.address() as any).port}`
  try {
    await page.goto(url)
    await page.getByRole('button', { name: 'Prova sul dispositivo' }).click()
    await page.getByRole('button', { name: 'Usa percorso iniziale' }).click()
    await page.getByRole('button', { name: 'Avvia' }).click()
    const session = page.getByRole('dialog', {
      name: 'FOCUS MODE · IL TUO ALLENAMENTO',
      exact: true,
    })
    await session.getByRole('textbox', { name: 'Serie 1 load', exact: true }).fill('12.5')
    await session.getByRole('textbox', { name: 'Serie 1 reps', exact: true }).fill('6')
    await session.getByRole('button', { name: 'Completa serie 1', exact: true }).click()
    await expect(session.getByText('Progressi salvati', { exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBeTruthy()
    const other = await context.newPage()
    await other.goto(url)
    await expect(other.getByRole('button', { name: 'Riprendi sessione' })).toBeVisible()
    release = 'two'
    // Returning to the foreground triggers the app's real update check. No direct SW activation.
    await other.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(other.locator('meta[name="test-release"]')).toHaveAttribute('content', 'two', {
      timeout: 30000,
    })
    await expect(page.locator('meta[name="test-release"]')).toHaveAttribute('content', 'one')
    await expect(session).toBeVisible()
    await expect(
      session.getByRole('textbox', { name: 'Serie 1 load', exact: true }),
    ).toHaveValue('12,5')
    await page.bringToFront()
    await session.getByRole('button', { name: 'Chiudi', exact: true }).click()
    await expect(page.locator('meta[name="test-release"]')).toHaveAttribute('content', 'two', {
      timeout: 15000,
    })
    await context.setOffline(true)
    await page.reload()
    await page.getByRole('button', { name: 'Riprendi sessione' }).click()
    await expect(
      session.getByRole('textbox', { name: 'Serie 1 load', exact: true }),
    ).toHaveValue('12,5')
    await expect(session.getByRole('button', { name: 'Riapri serie 1', exact: true })).toBeVisible()
    const queued = await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const request = indexedDB.open('gymbrain-v1')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const database = request.result
            const count = database.transaction('queue').objectStore('queue').count()
            count.onsuccess = () => {
              resolve(count.result)
              database.close()
            }
          }
        }),
    )
    expect(queued).toBeGreaterThan(0)
    await other.close()
  } finally {
    await context.setOffline(false)
    server.closeAllConnections()
    await new Promise<void>((done) => server.close(() => done()))
  }
})
