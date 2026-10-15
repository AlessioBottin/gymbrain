import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
const svg = await readFile(new URL('../public/favicon.svg', import.meta.url))
for (const size of [192, 512])
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(new URL(`../public/icon-${size}.png`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))
await sharp(svg).resize(180, 180).png().toFile('public/apple-touch-icon.png')
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#f4f1ea' } })
  .composite([{ input: await sharp(svg).resize(340, 340).toBuffer(), gravity: 'center' }])
  .png()
  .toFile('public/icon-maskable.png')
