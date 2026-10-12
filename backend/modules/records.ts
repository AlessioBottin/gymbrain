import Fastify from 'fastify'
import { mutationSchema, moduleFor, type Module } from '../../shared/domain.ts'
import { authenticate, errors } from '../lib/auth.ts'

// Each instance exposes a standalone HTTP contract and owns its repository/table.
export function createRecordsModule(module: Module, auth = authenticate) {
  const app = Fastify({ bodyLimit: 1024 * 1024 })
  errors(app)
  app.get('/records', async (req, reply) => {
    const { db, userId } = await auth(req)
    const after = Number((req.query as any).after || 0)
    if (!Number.isSafeInteger(after) || after < 0)
      return reply.code(400).send({ error: 'Cursore non valido' })
    const { data, error } = await db
      .from(`${module}_records`)
      .select('*')
      .eq('user_id', userId)
      .gt('revision', after)
      .order('revision')
      .limit(250)
    if (error) throw error
    return { records: data, cursor: data?.at(-1)?.revision || after, hasMore: data?.length === 250 }
  })
  app.post('/mutations', async (req, reply) => {
    const { db, userId } = await auth(req),
      parsed = mutationSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join('; ') })
    const m = parsed.data
    if (moduleFor(m.kind) !== module)
      return reply.code(400).send({ error: 'Tipo non appartenente al modulo' })
    if (m.kind === 'weight') {
      const { data: previous, error: readError } = await db
        .from('tracking_records')
        .select('payload')
        .eq('user_id', userId)
        .eq('id', m.id)
        .maybeSingle()
      if (readError) throw readError
      const payload = m.payload as any
      if (previous?.payload?.source === 'withings') {
        if (!m.deleted || JSON.stringify(previous.payload) !== JSON.stringify(payload)) {
          // Compare fields independent of PostgreSQL JSON key ordering.
          if (
            !m.deleted ||
            ['kg', 'measuredAt', 'source', 'externalId'].some(
              (k) => previous.payload[k] !== payload[k],
            )
          )
            return reply
              .code(400)
              .send({
                error:
                  'Le pesate Withings vengono aggiornate dalla bilancia. Puoi eliminarle o aggiungere una pesata manuale.',
              })
        }
      } else if (payload.source !== 'manual' || payload.externalId) {
        return reply
          .code(400)
          .send({ error: 'La provenienza Withings è riservata all’importazione.' })
      }
    }
    const { data, error } = await db.rpc(`${module}_server_apply`, {
      owner_id: userId,
      operation_id: m.operationId,
      record_id: m.id,
      record_kind: m.kind,
      parent_id: m.parentId,
      base_version: m.baseVersion,
      document: m.payload,
      is_deleted: m.deleted,
    })
    if (error) {
      if (['23503', '23514', '22023'].includes(error.code))
        return reply.code(400).send({ error: 'Relazione o dati non validi' })
      throw error
    }
    if (data.conflict) return reply.code(409).send(data)
    return data
  })
  return app
}
