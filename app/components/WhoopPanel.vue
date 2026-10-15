<script setup lang="ts">
import type { WhoopRecord, WhoopLink } from '../../shared/whoop';
import { recoveryBefore, overlappingWorkouts, sleepHours } from '../../shared/whoop';
import type { LocalRecord, TrainingSession } from '../../shared/domain';
const props = defineProps<{
  info: { configured: boolean; connected: boolean; lastSync?: string; pending?: boolean; error?: string };
  records: WhoopRecord[];
  links: WhoopLink[];
  sessions: LocalRecord[];
  loading: boolean;
  message: string;
  online: boolean;
  local: boolean;
}>();
const emit = defineEmits<{
  connect: [];
  sync: [];
  disconnect: [];
  link: [session: string, workout: string | null];
}>();
const filter = ref(''),
  showAll = ref(false);
const options = computed(() =>
  Array.from(
    new Map(
      props.sessions.flatMap((s) =>
        (s.payload as TrainingSession).exercises.map((e) => [
          e.exerciseId + ':' + (e.variant?.id || ''),
          {
            id: e.exerciseId + ':' + (e.variant?.id || ''),
            name: e.name + (e.variant ? ' ? ' + e.variant.name : ''),
          },
        ]),
      ),
    ).values(),
  ),
);
const today = computed(() => recoveryBefore(props.records, new Date().toISOString()));
const latestCycle = computed(
  () =>
    props.records
      .filter((r) => r.kind === 'cycle')
      .sort((a, b) => b.measured_at.localeCompare(a.measured_at))[0],
);
const comparisons = computed(() =>
  props.sessions
    .filter((s) => (s.payload as TrainingSession).completedAt)
    .map((s) => {
      const session = s.payload as TrainingSession,
        before = recoveryBefore(props.records, session.startedAt);
      const exercises = session.exercises.filter(
        (e) => !filter.value || e.exerciseId + ':' + (e.variant?.id || '') === filter.value,
      );
      const actual = exercises.flatMap((e) =>
        e.actual.filter((a) => a.done).map((a) => ({ ...a, measurement: e.measurement })),
      );
      const rpes = actual.map((a) => a.rpe).filter((n): n is number => n != null);
      const linked = props.links.find((l) => l.session_id === s.id);
      return {
        id: s.id,
        session,
        before,
        actual,
        rpe: rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null,
        candidates: overlappingWorkouts(props.records, session.startedAt, session.completedAt!),
        linked: linked?.workout_id || '',
        activity: props.records.find((r) => r.kind === 'workout' && r.provider_id === linked?.workout_id),
      };
    })
    .filter((s) => s.actual.length)
    .slice(0, showAll.value ? 100 : 8),
);
const number = (value: any, digits = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '?';
const date = (s: string) => new Date(s).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
const time = (s: string) => new Date(s).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
</script>
<template>
  <section class="panel whoop-panel">
    <div class="panel-title">
      <div>
        <span class="eyebrow">WHOOP ? RECUPERO E PERFORMANCE</span>
        <h2>Ascolta. Poi supera.</h2>
      </div>
      <span class="provider-badge">WHOOP</span>
    </div>
    <p class="subtle">Recupero, sonno e carico: il contesto delle tue sessioni, tutto nello stesso diario.</p>
    <p v-if="local" class="notice">Accedi a Gymbrain per collegare il tuo account WHOOP.</p>
    <p v-else-if="!info.configured" class="notice">
      Il collegamento WHOOP sar? disponibile quando il gestore avr? completato la configurazione.
    </p>
    <div v-else class="button-group">
      <button v-if="!info.connected" class="primary" :disabled="loading || !online" @click="emit('connect')">
        Collega WHOOP ?
      </button>
      <template v-else
        ><span class="connection-label">Account collegato</span
        ><button class="secondary" :disabled="loading || !online" @click="emit('sync')">
          {{ loading ? 'Sincronizzazione?' : 'Aggiorna WHOOP' }}</button
        ><button class="text-btn" :disabled="loading || !online" @click="emit('disconnect')">
          Scollega
        </button></template
      >
    </div>
    <p v-if="!online" class="notice">Offline ? stai consultando l'ultimo aggiornamento salvato.</p>
    <p v-if="info.lastSync" class="subtle">
      Aggiornato {{ new Date(info.lastSync).toLocaleString('it-IT') }}
    </p>
    <p v-if="message || info.error" class="notice" role="status">{{ message || info.error }}</p>
    <template v-if="records.length">
      <div class="recovery-metrics">
        <article>
          <span>Recupero</span
          ><strong>{{ number(today.recovery?.payload.score?.recovery_score) }}<small>%</small></strong
          ><small
            >Prima di oggi ? {{ today.sleep ? date(today.sleep.payload.end) : 'non disponibile' }}</small
          >
        </article>
        <article>
          <span>HRV</span
          ><strong>{{ number(today.recovery?.payload.score?.hrv_rmssd_milli, 1) }}<small>ms</small></strong
          ><small>Variabilit? cardiaca</small>
        </article>
        <article>
          <span>Sonno</span><strong>{{ number(sleepHours(today.sleep), 1) }}<small>h</small></strong
          ><small>Performance {{ number(today.sleep?.payload.score?.sleep_performance_percentage) }}%</small>
        </article>
        <article>
          <span>Strain del ciclo</span
          ><strong>{{
            number(
              latestCycle?.payload.score_state === 'SCORED' ? latestCycle?.payload.score?.strain : null,
              1,
            )
          }}</strong
          ><small>{{ latestCycle ? date(latestCycle.measured_at) : '?' }} ? aggiornabile</small>
        </article>
      </div>
      <div class="comparison-heading">
        <div>
          <h3>Come cambia il tuo allenamento</h3>
          <p class="subtle">
            Confronta lo stesso movimento, variante e carico. I dati mostrano associazioni, non cause.
          </p>
        </div>
        <label
          >Movimento<select v-model="filter">
            <option value="">Tutta la sessione</option>
            <option v-for="o in options" :key="o.id" :value="o.id">{{ o.name }}</option>
          </select></label
        >
      </div>
      <div class="comparison-list">
        <article v-for="row in comparisons" :key="row.id" class="comparison-row">
          <header>
            <strong>{{ row.session.name }}</strong
            ><span>{{ date(row.session.startedAt) }} ? {{ time(row.session.startedAt) }}</span>
          </header>
          <dl>
            <div>
              <dt>Recupero prima</dt>
              <dd>{{ number(row.before.recovery?.payload.score?.recovery_score) }}%</dd>
            </div>
            <div>
              <dt>HRV</dt>
              <dd>{{ number(row.before.recovery?.payload.score?.hrv_rmssd_milli, 1) }} ms</dd>
            </div>
            <div>
              <dt>Sonno precedente</dt>
              <dd>{{ number(sleepHours(row.before.sleep), 1) }} h</dd>
            </div>
            <div>
              <dt>Serie / RPE medio</dt>
              <dd>{{ row.actual.length }} / {{ number(row.rpe, 1) }}</dd>
            </div>
          </dl>
          <p v-if="filter" class="set-summary">
            Serie completate:
            {{
              row.actual
                .map(
                  (s) =>
                    `${s.measurement === 'duration' ? (s.tut ?? '?') + ' s' : (s.reps ?? '?') + ' rep'} ? ${s.load ?? 0} kg`,
                )
                .join(' ? ')
            }}
          </p>
          <p v-if="row.before.rescored" class="subtle">
            Recupero ricalcolato da WHOOP dopo la sessione: confronto retrospettivo.
          </p>
          <div class="activity-match">
            <label
              >Attivit? WHOOP associata<select
                :value="row.linked"
                :disabled="loading || !online || !info.connected"
                @change="emit('link', row.id, ($event.target as HTMLSelectElement).value || null)"
              >
                <option value="">Nessuna ? scegli un'attivit? sovrapposta</option>
                <option
                  v-if="row.activity && !row.candidates.some((c) => c.provider_id === row.linked)"
                  :value="row.linked"
                >
                  Attivit? confermata ? {{ time(row.activity.payload.start) }}
                </option>
                <option v-for="a in row.candidates" :key="a.provider_id" :value="a.provider_id">
                  {{ time(a.payload.start) }}?{{ time(a.payload.end) }} ? strain
                  {{ number(a.payload.score?.strain, 1) }}
                </option>
              </select></label
            ><strong v-if="row.activity"
              >Strain attivit?
              {{
                number(
                  row.activity.payload.score_state === 'SCORED' ? row.activity.payload.score?.strain : null,
                  1,
                )
              }}</strong
            >
          </div>
        </article>
      </div>
      <p v-if="!comparisons.length" class="notice">
        Completa una sessione per confrontarla con il recupero WHOOP.
      </p>
      <button v-if="sessions.length > 8 && !showAll" class="text-btn" @click="showAll = true">
        Mostra altre sessioni ?
      </button>
      <p class="subtle">
        Il sonno e il recupero sono riferiti al risveglio precedente (entro 36 ore). Il simbolo ? indica dati
        assenti o non ancora elaborati. Lo strain giornaliero non viene usato come recupero pre-allenamento.
      </p>
    </template>
  </section>
</template>
