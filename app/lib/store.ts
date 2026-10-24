import Dexie, { type Table } from 'dexie';
import {
  moduleFor,
  schemas,
  validRecordedSet,
  type TrainingSession,
  type Kind,
  type Module,
  type LocalRecord,
  type RecordRow,
  type Mutation,
  type Payload,
} from '../../shared/domain';

export interface Operation {
  seq?: number;
  owner: string;
  module: Module;
  mutation: Mutation;
  localRevision: number;
}
export class GymDB extends Dexie {
  records!: Table<LocalRecord, [string, string]>;
  queue!: Table<Operation, number>;
  meta!: Table<{ key: string; value: any }, string>;
  constructor(name = 'gymbrain-v1') {
    super(name);
    this.version(1).stores({
      records: '[user_id+id],user_id,[user_id+kind]',
      queue: '++seq,owner,[owner+module]',
      meta: 'key',
    });
    this.version(2)
      .stores({
        records: '[user_id+id],user_id,[user_id+kind]',
        queue: '++seq,owner,[owner+module]',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('records')
          .toCollection()
          .modify((row: LocalRecord) => {
            const parsed = schemas[row.kind].safeParse(row.payload);
            if (parsed.success) row.payload = parsed.data;
            if (row.conflict) {
              const remote = schemas[row.conflict.kind].safeParse(row.conflict.payload);
              if (remote.success) row.conflict.payload = remote.data;
            }
          });
        // Queued requests and operation IDs stay immutable: retries must retain their exact payload.
      });
  }
}
export const db = new GymDB();
export async function saveRecord(
  owner: string,
  kind: Kind,
  payload: Payload,
  options: {
    id?: string;
    parentId?: string | null;
    deleted?: boolean;
    expectedRevision?: number;
  } = {},
) {
  const valid = schemas[kind].parse(payload),
    id = options.id || crypto.randomUUID(),
    module = moduleFor(kind);
  if (kind === 'session' && !options.deleted) {
    const session = valid as TrainingSession;
    const recorded = session.exercises.flatMap((e) => e.actual.filter((s) => s.done).map((s) => ({ s, e })));
    if (recorded.some(({ s, e }) => !validRecordedSet(s, e.measurement)))
      throw new Error('Una serie registrata richiede ripetizioni intere positive o secondi positivi.');
    if (session.completedAt && !recorded.length) throw new Error('Completa almeno una serie valida.');
  }
  return db.transaction('rw', db.records, db.queue, async () => {
    const previous = await db.records.get([owner, id]);
    if (
      !previous &&
      module === 'training' &&
      owner !== 'local-device' &&
      globalThis.navigator?.onLine === false
    )
      throw new Error(
        'Per creare esercizi, mesocicli e schede serve una connessione. Puoi continuare il tuo allenamento offline.',
      );
    if (previous?.conflict) throw new Error('Risolvi prima il conflitto per questo elemento.');
    if (options.expectedRevision !== undefined && previous?.localRevision !== options.expectedRevision)
      throw new Error('Elemento modificato in un’altra finestra. Riaprilo prima di salvare.');
    const pending = (await db.queue.where('owner').equals(owner).toArray())
      .filter((o) => o.mutation.id === id)
      .sort((a, b) => a.seq! - b.seq!);
    const baseVersion = pending.length ? pending.at(-1)!.mutation.baseVersion + 1 : previous?.version || 0;
    const row: LocalRecord = {
      id,
      user_id: owner,
      kind,
      module,
      parent_id: options.parentId === undefined ? previous?.parent_id || null : options.parentId,
      payload: valid,
      version: previous?.version || 0,
      revision: previous?.revision || 0,
      deleted: options.deleted || false,
      updated_at: new Date().toISOString(),
      dirty: true,
      localRevision: (previous?.localRevision || 0) + 1,
    };
    await db.records.put(row);
    await db.queue.add({
      owner,
      module,
      localRevision: row.localRevision,
      mutation: {
        operationId: crypto.randomUUID(),
        id,
        kind,
        parentId: row.parent_id,
        baseVersion,
        payload: valid,
        deleted: row.deleted,
      },
    });
    return row;
  });
}
export async function acknowledge(owner: string, op: Operation, remote: RecordRow) {
  remote.payload = schemas[remote.kind].parse(remote.payload);
  await db.transaction('rw', db.records, db.queue, async () => {
    const row = await db.records.get([owner, remote.id]);
    await db.queue.delete(op.seq!);
    if (row) {
      const latest = row.localRevision === op.localRevision;
      await db.records.put({
        ...row,
        ...(latest ? remote : { version: remote.version, revision: remote.revision }),
        dirty: !latest,
        localRevision: row.localRevision,
      });
    }
  });
}
export async function resolveConflict(owner: string, id: string, keepLocal: boolean) {
  await db.transaction('rw', db.records, db.queue, async () => {
    const row = await db.records.get([owner, id]);
    if (!row?.conflict) return;
    const remote = row.conflict;
    for (const op of await db.queue.where('owner').equals(owner).toArray())
      if (op.mutation.id === id) await db.queue.delete(op.seq!);
    const next = {
      ...row,
      ...(keepLocal ? { version: remote.version, revision: remote.revision } : remote),
      conflict: undefined,
      dirty: keepLocal,
      localRevision: row.localRevision + 1,
    };
    await db.records.put(next);
    if (keepLocal)
      await db.queue.add({
        owner,
        module: row.module,
        localRevision: next.localRevision,
        mutation: {
          operationId: crypto.randomUUID(),
          id,
          kind: row.kind,
          parentId: row.parent_id,
          baseVersion: remote.version,
          payload: row.payload,
          deleted: row.deleted,
        },
      });
  });
}
export async function removeAccountCache(owner: string) {
  if (typeof localStorage !== 'undefined') {
    for (const key of Object.keys(localStorage))
      if (key.startsWith(`gymbrain-draft:${owner}:`)) localStorage.removeItem(key);
  }
  await db.transaction('rw', db.records, db.queue, db.meta, async () => {
    await db.records.where('user_id').equals(owner).delete();
    await db.queue.where('owner').equals(owner).delete();
    for (const m of await db.meta.toArray()) if (m.key.startsWith(owner + ':')) await db.meta.delete(m.key);
  });
}
export async function synchronize(
  owner: string,
  getToken: () => Promise<string | null>,
  setStatus: (s: string) => void,
) {
  const run = async () => {
    if (!navigator.onLine) {
      setStatus('Offline · salvataggio sul dispositivo');
      return;
    }
    const token = await getToken();
    if (!token) {
      setStatus('Accedi per sincronizzare');
      return;
    }
    const request = async (path: string, body?: unknown) => {
      const r = await fetch('/api/' + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(75000),
      });
      const data = await r.json();
      if (r.status === 401)
        throw new Error('Sessione scaduta: accedi per sincronizzare. I dati locali restano salvati.');
      if (!r.ok && r.status !== 409) throw new Error(data.error || 'Sincronizzazione non disponibile');
      return { data, status: r.status };
    };
    setStatus('Sincronizzazione…');
    try {
      // Training precedes tracking. Queue payloads and operation IDs never change on retry.
      for (const module of ['training', 'tracking'] as Module[]) {
        const blocked = new Set<string>();
        for (const op of await db.queue.where('[owner+module]').equals([owner, module]).sortBy('seq')) {
          if (blocked.has(op.mutation.id)) continue;
          const local = await db.records.get([owner, op.mutation.id]);
          if (local?.conflict) {
            blocked.add(local.id);
            continue;
          }
          const { data, status } = await request(module + '/mutations', op.mutation);
          if (status === 409) {
            if (data.record && local) {
              data.record.payload = schemas[data.record.kind as Kind].parse(data.record.payload);
              await db.records.update([owner, local.id], { conflict: data.record });
            }
            blocked.add(op.mutation.id);
            continue;
          }
          await acknowledge(owner, op, data.record);
        }
        const key = owner + ':cursor:' + module;
        let cursor = (await db.meta.get(key))?.value || 0;
        while (true) {
          const { data } = await request(module + '/records?after=' + cursor);
          await db.transaction('rw', db.records, db.meta, async () => {
            for (const row of data.records as RecordRow[]) {
              if (row.user_id !== owner) throw new Error('Identità inattesa nella risposta');
              row.payload = schemas[row.kind].parse(row.payload);
              const local = await db.records.get([owner, row.id]);
              if (!local?.dirty && (!local || row.version > local.version))
                await db.records.put({
                  ...row,
                  module,
                  localRevision: (local?.localRevision || 0) + 1,
                });
            }
            await db.meta.put({ key, value: data.cursor });
          });
          cursor = data.cursor;
          if (!data.hasMore) break;
        }
      }
      const count = await db.queue.where('owner').equals(owner).count();
      setStatus(count ? 'Modifiche in attesa · controlla i conflitti' : 'Sincronizzato');
    } catch (e) {
      setStatus(
        e instanceof Error ? e.message : 'Connessione non disponibile. Dati salvati sul dispositivo.',
      );
    }
  };
  if (navigator.locks)
    await navigator.locks.request('gymbrain-sync:' + owner, { ifAvailable: true }, (lock) =>
      lock ? run() : Promise.resolve(),
    );
  else await run();
}

// All day edits and outbox operations commit together, including conflict checks.
export async function savePlanWorkouts(
  owner: string,
  planId: string,
  days: { id: string; revision?: number; payload: import('../../shared/domain').Workout }[],
) {
  return db.transaction('rw', db.records, db.queue, async () => {
    const plan = await db.records.get([owner, planId]);
    if (!plan || plan.deleted || plan.kind !== 'plan' || plan.conflict)
      throw new Error('Scheda non disponibile o in conflitto.');
    const saved: LocalRecord[] = [];
    for (const day of days) {
      const previous = await db.records.get([owner, day.id]);
      if (previous && (previous.deleted || previous.parent_id !== planId || day.revision === undefined))
        throw new Error('Giornata modificata: riapri il builder.');
      saved.push(
        await saveRecord(owner, 'workout', day.payload, {
          id: day.id,
          parentId: planId,
          expectedRevision: day.revision,
        }),
      );
    }
    return saved;
  });
}
