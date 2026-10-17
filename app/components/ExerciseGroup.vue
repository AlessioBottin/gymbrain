<script setup lang="ts">
import type { Prescription } from '../../shared/domain';
const props = defineProps<{ exercise: Prescription; exercises: Prescription[] }>();
const groups = computed(() =>
  props.exercises.filter((e, i, all) => e.group && all.findIndex((x) => x.group?.id === e.group!.id) === i),
);
function choose(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (!value) delete props.exercise.group;
  else if (value === 'jump' || value === 'superset')
    props.exercise.group = { id: crypto.randomUUID(), type: value, restSeconds: 60 };
  else {
    const source = props.exercises.find((e) => e.group?.id === value);
    if (source?.group) props.exercise.group = { ...source.group };
  }
}
function rest(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  for (const e of props.exercises)
    if (e.group?.id === props.exercise.group?.id && e.group) e.group.restSeconds = value;
}
</script>
<template>
  <label
    >Gruppo di esecuzione<select :value="exercise.group?.id || ''" @change="choose">
      <option value="">Serie singole</option>
      <option value="jump">Nuovo jump set</option>
      <option value="superset">Nuovo superset</option>
      <option v-for="(e, i) in groups" :key="e.group!.id" :value="e.group!.id">
        {{ e.group!.type === 'jump' ? 'Jump set' : 'Superset' }} {{ i + 1 }} · {{ e.name }}
      </option>
    </select></label
  >
  <template v-if="exercise.group">
    <label
      >{{ exercise.group.type === 'jump' ? 'Pausa tra esercizi (secondi)' : 'Pausa tra giri (secondi)'
      }}<input :value="exercise.group.restSeconds" type="number" min="0" max="3600" required @input="rest"
    /></label>
    <p class="notice">
      {{
        exercise.group.type === 'jump'
          ? 'A → pausa → B → pausa → prossimo giro.'
          : 'A → B senza pausa → recupero → prossimo giro.'
      }}
      Ordine della giornata; i giri seguono le serie di ogni esercizio. Collega almeno due esercizi allo
      stesso gruppo.
    </p>
  </template>
</template>
