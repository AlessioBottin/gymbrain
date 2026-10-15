import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
export const scopes = 'offline read:profile read:recovery read:sleep read:cycles read:workout';
export const config = () => {
  const origin = process.env.APP_ORIGIN || '',
    clientId = process.env.WHOOP_CLIENT_ID || '',
    secret = process.env.WHOOP_CLIENT_SECRET || '',
    key = process.env.WHOOP_ENCRYPTION_KEY || '';
  return {
    origin,
    clientId,
    secret,
    key,
    callback: origin + '/api/whoop/callback',
    configured: /^https:\/\/[^/]+$/.test(origin) && !!clientId && !!secret && /^[a-f0-9]{64}$/i.test(key),
  };
};
export const kinds = ['sleep', 'recovery', 'cycle', 'workout'] as const;
export type WhoopKind = (typeof kinds)[number];
const paths = { sleep: 'activity/sleep', recovery: 'recovery', cycle: 'cycle', workout: 'activity/workout' };
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  scope: z.string(),
});
export class WhoopError extends Error {
  constructor(
    public statusCode: number,
    public retryAfter = 60,
  ) {
    super(
      statusCode === 429
        ? 'Limite WHOOP raggiunto. Riprova tra qualche minuto.'
        : 'WHOOP non disponibile. Riprova o ricollega il tuo account.',
    );
  }
}
export class WhoopProvider {
  constructor(private request: typeof fetch = fetch) {}
  async response(response: Response) {
    if (!response.ok)
      throw new WhoopError(
        response.status === 429 ? 429 : response.status === 404 ? 404 : 502,
        Math.min(3600, Math.max(30, Number(response.headers.get('retry-after')) || 60)),
      );
    return response.status === 204 ? null : response.json();
  }
  async token(params: Record<string, string>) {
    const c = config();
    const data = await this.response(
      await this.request('https://api.prod.whoop.com/oauth/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: c.clientId, client_secret: c.secret, ...params }),
        signal: AbortSignal.timeout(15000),
      }),
    );
    return tokenSchema.parse(data);
  }
  exchange(code: string) {
    return this.token({ grant_type: 'authorization_code', code, redirect_uri: config().callback });
  }
  refresh(refresh_token: string) {
    return this.token({ grant_type: 'refresh_token', refresh_token, scope: scopes });
  }
  async get(path: string, token: string, method = 'GET') {
    return this.response(
      await this.request('https://api.prod.whoop.com/developer/v2/' + path, {
        method,
        headers: { authorization: 'Bearer ' + token },
        signal: AbortSignal.timeout(15000),
      }),
    );
  }
  async identity(token: string) {
    const data = await this.get('user/profile/basic', token);
    if (!Number.isSafeInteger(data?.user_id)) throw new WhoopError(502);
    return String(data.user_id); // Do not persist profile name/email.
  }
  revoke(token: string) {
    return this.get('user/access', token, 'DELETE');
  }
  async page(kind: WhoopKind, token: string, cursor: { next?: string; start?: string; end: string }) {
    const params = new URLSearchParams({ limit: '25', end: cursor.end });
    if (cursor.start) params.set('start', cursor.start);
    if (cursor.next) params.set('nextToken', cursor.next);
    const data = await this.get(paths[kind] + '?' + params, token);
    if (!Array.isArray(data?.records) || (data.next_token != null && typeof data.next_token !== 'string'))
      throw new WhoopError(502);
    return data as { records: any[]; next_token?: string };
  }
  async event(kind: WhoopKind, id: string, token: string) {
    if (kind === 'recovery') {
      const sleep = await this.get('activity/sleep/' + encodeURIComponent(id), token);
      return this.get('cycle/' + encodeURIComponent(sleep.cycle_id) + '/recovery', token);
    }
    return this.get(paths[kind] + '/' + encodeURIComponent(id), token);
  }
}
export function validSignature(
  raw: string,
  timestamp: string,
  signature: string,
  secret: string,
  now = Date.now(),
) {
  if (!/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 300000 || !secret) return false;
  const expected = createHmac('sha256', secret)
    .update(timestamp + raw)
    .digest('base64');
  return (
    signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  );
}
export function normalize(kind: WhoopKind, raw: any, providerUser: string) {
  if (String(raw?.user_id) !== providerUser) throw new WhoopError(502);
  const id = String(kind === 'recovery' ? raw.cycle_id : raw.id);
  if (!id || id === 'undefined' || !Number.isFinite(Date.parse(raw.updated_at))) throw new WhoopError(502);
  const start = kind === 'recovery' ? raw.created_at : raw.start;
  if (!Number.isFinite(Date.parse(start))) throw new WhoopError(502);
  return {
    kind,
    provider_id: id,
    measured_at: start,
    provider_updated_at: raw.updated_at,
    payload: raw,
    deleted: false,
  };
}
