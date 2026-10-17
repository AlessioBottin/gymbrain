<script setup lang="ts">
import { muscleGroups, type Prescription, type LocalRecord } from '../../shared/domain';
import { volume } from '../../shared/volume';
const props = defineProps<{ exercises: Prescription[]; catalog?: LocalRecord[] }>();
const totals = computed(() => volume(props.exercises, props.catalog));
</script>
<template>
  <details class="volume-summary" open>
    <summary>Volume · serie equivalenti per muscolo</summary>
    <dl class="muscle-grid" aria-live="polite">
      <div v-for="(label, m) in muscleGroups" :key="m">
        <dt>{{ label }}</dt>
        <dd>{{ totals[m].toLocaleString('it-IT') }}</dd>
      </div>
    </dl>
    <p class="notice">
      Serie incluse × coefficiente personale. Totale delle giornate mostrate, non moltiplicato per il periodo.
    </p>
  </details>
</template>
