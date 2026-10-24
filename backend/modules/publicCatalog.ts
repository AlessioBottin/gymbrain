import Fastify from 'fastify';
import { authenticate, errors } from '../lib/auth.ts';
import { publicExercise } from '../../shared/publicCatalog.ts';

export function createPublicCatalogModule(auth = authenticate) {
  const app = Fastify();
  errors(app);
  app.get('/exercises', async (req, reply) => {
    const { db } = await auth(req);
    reply.header('cache-control', 'no-store');
    const page = Number((req.query as any).page || 0);
    if (!Number.isSafeInteger(page) || page < 0 || page > 10000)
      return reply.code(400).send({ error: 'Pagina non valida' });
    const { data, error } = await db
      .from('training_records')
      .select('id,payload')
      .eq('kind', 'exercise')
      .eq('deleted', false)
      .eq('payload->>isPublic', 'true')
      .order('id')
      .range(page * 100, page * 100 + 100);
    if (error) throw error;
    return { exercises: (data || []).slice(0, 100).map(publicExercise), hasMore: (data || []).length > 100 };
  });
  return app;
}
