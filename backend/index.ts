import { createApp } from './app.ts'
const app = await createApp()
await app.listen({
  port: Number(process.env.PORT || 3001),
  host: process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1',
})
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => app.close().then(() => process.exit(0)))
