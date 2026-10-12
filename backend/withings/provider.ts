import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { weightSchema } from '../../shared/domain.ts'

export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export function configuration() {
  const origin = process.env.APP_ORIGIN || ''
  const clientId = process.env.WITHINGS_CLIENT_ID || ''
  const secret = process.env.WITHINGS_CLIENT_SECRET || ''
  const encryptionKey = process.env.WITHINGS_ENCRYPTION_KEY || ''
  const configured =
    /^https:\/\/[^/]+$/.test(origin) &&
    !!clientId &&
    !!secret &&
    /^[a-f\d]{64}$/i.test(encryptionKey)
  return {
    origin,
    clientId,
    secret,
    encryptionKey,
    configured,
    callback: origin + '/api/withings/callback',
  }
}
export function seal(value: unknown, owner: string, key = configuration().encryptionKey) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv)
  cipher.setAAD(Buffer.from(owner))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map((b) => b.toString('base64url')).join('.')
}
export function unseal(value: string, owner: string, key = configuration().encryptionKey) {
  const [iv, tag, encrypted] = value.split('.').map((v) => Buffer.from(v, 'base64url'))
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv!)
  cipher.setAAD(Buffer.from(owner))
  cipher.setAuthTag(tag!)
  return JSON.parse(Buffer.concat([cipher.update(encrypted!), cipher.final()]).toString('utf8'))
}
export class ProviderError extends Error {
  constructor(public code: number) {
    super('Withings non disponibile. Riprova o ricollega il tuo account.')
  }
}
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.coerce.number().positive(),
  userid: z
    .union([z.string().regex(/^\d+$/), z.number().int().nonnegative()])
    .transform(String)
    .optional(),
  scope: z.string().optional(),
})
export class WithingsProvider {
  constructor(private request: typeof fetch = fetch) {}
  async call(path: string, params: Record<string, string | number>, token?: string): Promise<any> {
    const response = await this.request('https://wbsapi.withings.net' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])),
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new ProviderError(response.status)
    const data = (await response.json()) as any
    if (data.status !== 0) throw new ProviderError(Number(data.status))
    return data.body
  }
  async signed(action: string, params: Record<string, string>) {
    const { clientId, secret } = configuration(),
      timestamp = Math.floor(Date.now() / 1000)
    const sign = (last: string | number, name: string) =>
      createHmac('sha256', secret).update([name, clientId, last].join(',')).digest('hex')
    const { nonce } = await this.call('/v2/signature', {
      action: 'getnonce',
      client_id: clientId,
      timestamp,
      signature: sign(timestamp, 'getnonce'),
    })
    if (typeof nonce !== 'string' || !nonce) throw new ProviderError(502)
    return this.call('/v2/oauth2', {
      action,
      client_id: clientId,
      nonce,
      signature: sign(nonce, action),
      ...params,
    })
  }
  async exchange(code: string) {
    return tokenSchema.parse(
      await this.signed('requesttoken', {
        grant_type: 'authorization_code',
        code,
        redirect_uri: configuration().callback,
      }),
    )
  }
  async refresh(refresh_token: string) {
    return tokenSchema.parse(
      await this.signed('requesttoken', { grant_type: 'refresh_token', refresh_token }),
    )
  }
  revoke(userid: string) {
    return this.signed('revoke', { userid })
  }
  subscribe(token: string, secret: string) {
    return this.call(
      '/notify',
      {
        action: 'subscribe',
        callbackurl: configuration().origin + '/api/withings/webhook/' + secret,
        appli: 1,
      },
      token,
    )
  }
  measures(token: string, since: number, offset: number) {
    return this.call(
      '/measure',
      { action: 'getmeas', meastype: 1, category: 1, lastupdate: since, offset },
      token,
    )
  }
}
export function parseMeasures(body: any, providerUser: string) {
  if (!Array.isArray(body?.measuregrps)) throw new ProviderError(502)
  const weights = body.measuregrps.flatMap((group: any) => {
    if (group.category !== 1) return []
    const measure = group.measures?.find((m: any) => m.type === 1)
    if (!measure) return []
    if (
      !Number.isSafeInteger(Number(group.grpid)) ||
      !Number.isSafeInteger(group.date) ||
      !Number.isFinite(measure.value) ||
      !Number.isInteger(measure.unit) ||
      Math.abs(measure.unit) > 10
    )
      throw new ProviderError(502)
    const weight = weightSchema.parse({
      kg: Number((measure.value * 10 ** measure.unit).toFixed(6)),
      measuredAt: new Date(group.date * 1000).toISOString(),
      source: 'withings',
      externalId: `withings:${providerUser}:${group.grpid}`,
    })
    return [weight]
  })
  const more = body.more === 1 || body.more === true
  if (more && (!Number.isSafeInteger(body.offset) || body.offset <= 0)) throw new ProviderError(502)
  return { weights, more, offset: more ? (body.offset as number) : 0 }
}
