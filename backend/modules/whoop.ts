import Fastify from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authenticate, serverClient, errors } from '../lib/auth.ts';
import { digest, seal, unseal } from '../withings/provider.ts';
import { config, scopes, kinds, WhoopProvider, WhoopError, normalize } from '../whoop/provider.ts';

export function createWhoopModule(
  auth = authenticate,
  database = serverClient,
  provider = new WhoopProvider(),
) {
  const app = Fastify({ bodyLimit: 16384 });
  errors(app);
  const running = new Set<Promise<unknown>>();
  app.addHook('onClose', async () => {
    await Promise.allSettled(running);
  });
  function launch(owner: string) {
    const task = sync(owner, true)
      .catch(() => undefined)
      .finally(() => running.delete(task));
    running.add(task);
  }
  const checked = (r: any): any => {
    if (r.error) throw new Error('Archivio WHOOP non disponibile');
    return r.data;
  };
  const db = () => database();
  const row = async (owner: string) =>
    checked(await db().from('whoop_connections').select('*').eq('user_id', owner).maybeSingle());
  const patch = async (owner: string, value: object) =>
    checked(await db().from('whoop_connections').update(value).eq('user_id', owner));
  const requireConfig = () => {
    if (!config().configured)
      throw Object.assign(new Error('WHOOP non ancora configurato'), { statusCode: 503 });
  };
  async function locked<T>(owner: string, action: (renew: () => Promise<void>) => Promise<T>) {
    const lease = randomUUID();
    if (!checked(await db().rpc('whoop_acquire', { owner_id: owner, lease })))
      throw Object.assign(new Error('Sincronizzazione WHOOP in corso. Riprova tra poco.'), {
        statusCode: 409,
      });
    try {
      return await action(async () => {
        if (!checked(await db().rpc('whoop_acquire', { owner_id: owner, lease })))
          throw new Error('Lease expired');
      });
    } finally {
      checked(await db().from('whoop_leases').delete().eq('user_id', owner).eq('lease_id', lease));
    }
  }
  async function access(owner: string, connection: any) {
    let token = unseal(connection.tokens, 'whoop:' + owner, config().key);
    if (token.expiresAt < Date.now() + 60000) {
      const next = await provider.refresh(token.refresh_token);
      token = { ...next, expiresAt: Date.now() + next.expires_in * 1000 };
      await patch(owner, { tokens: seal(token, 'whoop:' + owner, config().key) });
    }
    return token.access_token as string;
  }
  async function sync(owner: string, automatic = false) {
    requireConfig();
    return locked(owner, async (renew) => {
      const connection = await row(owner);
      if (!connection) return { connected: false, more: false, imported: 0 };
      if (connection.retry_at && Date.parse(connection.retry_at) > Date.now()) throw new WhoopError(429);
      const events =
        checked(
          await db().from('whoop_events').select('*').eq('user_id', owner).order('created_at').limit(3),
        ) || [];
      if (
        automatic &&
        !connection.cursor &&
        !events.length &&
        connection.last_sync &&
        Date.now() - Date.parse(connection.last_sync) < 300000
      )
        return { more: false, imported: 0 };
      let imported = 0;
      try {
        const token = await access(owner, connection);
        // Process signed notifications against current provider state, including historical edits.
        for (const event of events) {
          await renew();
          if (event.deleted) {
            const query = db()
              .from('whoop_records')
              .update({ deleted: true })
              .eq('user_id', owner)
              .eq('kind', event.kind);
            checked(
              await (event.kind === 'recovery'
                ? query.eq('payload->>sleep_id', event.provider_id)
                : query.eq('provider_id', event.provider_id)),
            );
          } else {
            try {
              const raw = await provider.event(event.kind, event.provider_id, token);
              checked(
                await db()
                  .from('whoop_records')
                  .upsert(
                    { user_id: owner, ...normalize(event.kind, raw, connection.provider_user) },
                    { onConflict: 'user_id,kind,provider_id' },
                  ),
              );
            } catch (error) {
              if (!(error instanceof WhoopError) || error.statusCode !== 404) throw error;
              const query = db()
                .from('whoop_records')
                .update({ deleted: true })
                .eq('user_id', owner)
                .eq('kind', event.kind);
              checked(
                await (event.kind === 'recovery'
                  ? query.eq('payload->>sleep_id', event.provider_id)
                  : query.eq('provider_id', event.provider_id)),
              );
            }
          }
          checked(
            await db().from('whoop_events').delete().eq('user_id', owner).eq('trace_id', event.trace_id),
          );
        }
        const cursor = connection.cursor || {
          index: 0,
          next: undefined,
          end: new Date().toISOString(),
          start: connection.last_sync
            ? new Date(Date.parse(connection.last_sync) - 7 * 86400000).toISOString()
            : undefined,
        };
        // One page/request keeps remote calls below the lease duration; cursor survives restarts.
        const kind = kinds[cursor.index]!;
        const page = await provider.page(kind, token, cursor);
        for (const raw of page.records) {
          await renew();
          checked(
            await db()
              .from('whoop_records')
              .upsert(
                { user_id: owner, ...normalize(kind, raw, connection.provider_user) },
                { onConflict: 'user_id,kind,provider_id' },
              ),
          );
          imported++;
        }
        if (page.next_token && page.next_token === cursor.next) throw new WhoopError(502);
        if (page.next_token) cursor.next = page.next_token;
        else {
          cursor.index++;
          delete cursor.next;
        }
        const more = cursor.index < kinds.length;
        await patch(owner, {
          cursor: more ? cursor : null,
          ...(!more ? { last_sync: cursor.end } : {}),
          error: null,
          retry_at: null,
        });
        return { more: more || events.length === 3, imported };
      } catch (error) {
        await patch(owner, {
          error: 'Aggiornamento WHOOP non riuscito. I dati salvati restano disponibili.',
          retry_at:
            error instanceof WhoopError && error.statusCode === 429
              ? new Date(Date.now() + error.retryAfter * 1000).toISOString()
              : null,
        });
        throw error;
      }
    });
  }
  app.get('/status', async (req) => {
    const { userId } = await auth(req);
    if (!config().configured) return { configured: false, connected: false };
    const r = await row(userId);
    return {
      configured: true,
      connected: !!r,
      lastSync: r?.last_sync,
      pending: !!r?.cursor,
      error: r?.error,
    };
  });
  app.post('/connect', async (req) => {
    const { userId } = await auth(req);
    requireConfig();
    if (await row(userId)) throw Object.assign(new Error('Scollega prima WHOOP'), { statusCode: 409 });
    const state = randomBytes(32).toString('hex');
    checked(await db().from('whoop_states').delete().eq('user_id', userId));
    checked(await db().from('whoop_states').delete().lt('expires_at', new Date().toISOString()));
    checked(
      await db()
        .from('whoop_states')
        .insert({
          user_id: userId,
          state_hash: digest(state),
          expires_at: new Date(Date.now() + 600000).toISOString(),
        }),
    );
    const url = new URL('https://api.prod.whoop.com/oauth/oauth2/auth');
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: config().clientId,
      redirect_uri: config().callback,
      scope: scopes,
      state,
    }).toString();
    return { url: url.toString(), state };
  });
  app.post('/callback', async (req) => {
    requireConfig();
    const { state, code } = z
      .object({ state: z.string().regex(/^[a-f0-9]{64}$/), code: z.string().min(1).max(2048) })
      .parse(req.body);
    const stored = checked(
      await db()
        .from('whoop_states')
        .delete()
        .eq('state_hash', digest(state))
        .gt('expires_at', new Date().toISOString())
        .select('user_id')
        .maybeSingle(),
    );
    if (!stored) return { connected: false };
    return locked(stored.user_id, async () => {
      if (await row(stored.user_id)) return { connected: false };
      const token = await provider.exchange(code);
      const granted = new Set(token.scope.split(/[ ,]+/));
      if (scopes.split(' ').some((s) => !granted.has(s))) return { connected: false };
      const providerUser = await provider.identity(token.access_token);
      checked(
        await db()
          .from('whoop_connections')
          .insert({
            user_id: stored.user_id,
            provider_user: providerUser,
            tokens: seal(
              { ...token, expiresAt: Date.now() + token.expires_in * 1000 },
              'whoop:' + stored.user_id,
              config().key,
            ),
          }),
      );
      return { connected: true };
    });
  });
  app.post('/sync', async (req) => {
    const { userId } = await auth(req);
    return sync(userId, (req.body as any)?.automatic === true);
  });
  app.get('/data', async (req) => {
    const { userId } = await auth(req);
    if (!config().configured) return { records: [], links: [] };
    // Paginated locally; never mix owners, and never expose connection tokens.
    const after = z.coerce
      .number()
      .int()
      .min(0)
      .max(1000000)
      .parse((req.query as any).after || 0);
    const records =
      checked(
        await db()
          .from('whoop_records')
          .select('kind,provider_id,measured_at,provider_updated_at,payload')
          .eq('user_id', userId)
          .eq('deleted', false)
          .order('kind')
          .order('provider_id')
          .range(after, after + 249),
      ) || [];
    const links =
      after === 0
        ? checked(await db().from('whoop_links').select('session_id,workout_id').eq('user_id', userId))
        : [];
    return { records, links, more: records.length === 250, next: after + records.length };
  });
  app.post('/link', async (req) => {
    const { userId } = await auth(req);
    const value = z
      .object({ session: z.uuid(), workout: z.string().min(1).max(128).nullable() })
      .parse(req.body);
    const session = checked(
      await db()
        .from('tracking_records')
        .select('id')
        .eq('user_id', userId)
        .eq('kind', 'session')
        .eq('id', value.session)
        .eq('deleted', false)
        .maybeSingle(),
    );
    if (!session) throw Object.assign(new Error('Sessione non trovata'), { statusCode: 404 });
    if (value.workout) {
      const workout = checked(
        await db()
          .from('whoop_records')
          .select('provider_id')
          .eq('user_id', userId)
          .eq('kind', 'workout')
          .eq('provider_id', value.workout)
          .eq('deleted', false)
          .maybeSingle(),
      );
      if (!workout) throw Object.assign(new Error('Attivit? non trovata'), { statusCode: 404 });
      checked(
        await db()
          .from('whoop_links')
          .upsert(
            { user_id: userId, session_id: value.session, workout_id: value.workout },
            { onConflict: 'user_id,session_id' },
          ),
      );
    } else
      checked(await db().from('whoop_links').delete().eq('user_id', userId).eq('session_id', value.session));
    return { ok: true };
  });
  app.post('/disconnect', async (req) => {
    const { userId } = await auth(req);
    requireConfig();
    return locked(userId, async () => {
      const r = await row(userId);
      if (r) {
        await provider.revoke(await access(userId, r));
        checked(await db().from('whoop_connections').delete().eq('user_id', userId));
      }
      checked(await db().from('whoop_states').delete().eq('user_id', userId));
      checked(await db().from('whoop_events').delete().eq('user_id', userId));
      return { connected: false };
    });
  });
  // Only the gateway calls this after raw-body signature verification.
  app.post('/webhook', async (req) => {
    const event = z
      .object({
        user_id: z.number().int().nonnegative(),
        id: z.uuid(),
        trace_id: z.string().min(1).max(128),
        type: z.enum([
          'sleep.updated',
          'sleep.deleted',
          'recovery.updated',
          'recovery.deleted',
          'workout.updated',
          'workout.deleted',
        ]),
      })
      .parse(req.body);
    const r = checked(
      await db()
        .from('whoop_connections')
        .select('user_id')
        .eq('provider_user', String(event.user_id))
        .maybeSingle(),
    );
    if (r)
      checked(
        await db()
          .from('whoop_events')
          .upsert(
            {
              trace_id: event.trace_id,
              user_id: r.user_id,
              kind: event.type.split('.')[0],
              provider_id: event.id,
              deleted: event.type.endsWith('.deleted'),
            },
            { onConflict: 'trace_id', ignoreDuplicates: true },
          ),
      );
    if (r) setImmediate(() => launch(r.user_id));
    return { received: true };
  });
  return app;
}
