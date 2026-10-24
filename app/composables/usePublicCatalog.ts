import type { Ref } from 'vue';
import { db } from '../lib/store';
import { exerciseSchema, type LocalRecord } from '../../shared/domain';
import type { PublicExercise } from '../../shared/publicCatalog';

export function usePublicCatalog(owner: Ref<string>, getToken: () => Promise<string | null>) {
  const records = ref<LocalRecord[]>([]);
  const message = ref('');
  let task: Promise<void> | undefined;
  watch(
    owner,
    async (id) => {
      records.value = [];
      message.value = '';
      if (!id || id === 'local-device') return;
      const cache = await db.meta.get(id + ':public-catalog');
      if (owner.value === id && Array.isArray(cache?.value)) records.value = cache.value;
    },
    { immediate: true },
  );
  async function refresh() {
    if (task) return task;
    const id = owner.value;
    if (!id || id === 'local-device' || !navigator.onLine) return;
    task = (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const collected: LocalRecord[] = [];
        let page = 0,
          hasMore = true;
        while (hasMore) {
          const response = await fetch(`/api/public-catalog/exercises?page=${page}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(15000),
          });
          const result = await response.json();
          if (!response.ok) throw new Error('Esercizi condivisi temporaneamente non disponibili.');
          for (const exercise of result.exercises as PublicExercise[]) {
            const { id: exerciseId, ...payload } = exercise;
            collected.push({
              id: exerciseId,
              user_id: 'public-catalog',
              kind: 'exercise',
              module: 'training',
              parent_id: null,
              deleted: false,
              version: 0,
              revision: 0,
              localRevision: 0,
              updated_at: '',
              payload: exerciseSchema.parse({
                ...payload,
                notes: '',
                videoUrl: '',
                videoPath: '',
                variants: payload.variants.map((v) => ({ ...v, notes: '' })),
              }),
            });
          }
          hasMore = result.hasMore === true;
          page++;
        }
        if (owner.value !== id) return;
        records.value = collected;
        message.value = '';
        await db.meta.put({ key: id + ':public-catalog', value: collected });
      } catch {
        if (owner.value === id)
          message.value = 'Esercizi condivisi non aggiornati. Riprova quando sei online.';
      } finally {
        task = undefined;
      }
    })();
    return task;
  }
  return { records, message, refresh };
}
