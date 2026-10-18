<script setup lang="ts">
import { muscleGroups, type Muscle, type Prescription, type LocalRecord } from '../../shared/domain';
import { volume } from '../../shared/volume';
const props = defineProps<{ exercises: Prescription[]; catalog?: LocalRecord[] }>();
const totals = computed(() => volume(props.exercises, props.catalog));
const activeMuscles = computed(() =>
  (Object.keys(muscleGroups) as Muscle[]).filter((m) => totals.value[m] > 0),
);
</script>
<template>
  <details class="volume-summary" open>
    <summary>Volume · serie equivalenti per muscolo</summary>
    <p v-if="!activeMuscles.length" class="notice">Nessun volume target: imposta i muscoli degli esercizi.</p>
    <dl class="muscle-grid" aria-live="polite">
      <div v-for="m in activeMuscles" :key="m">
        <dt>{{ muscleGroups[m] }}</dt>
        <dd>{{ totals[m].toLocaleString('it-IT') }}</dd>
      </div>
    </dl>
    <p class="notice">
      Serie incluse × coefficiente personale. Totale delle giornate mostrate, non moltiplicato per il periodo.
    </p>
  </details>
</template>
