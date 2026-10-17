<script setup lang="ts">
import type { Target } from '../../shared/domain';
const props = defineProps<{ set: Target; measurement?: string }>();
function technique(event: Event) {
  const type = (event.target as HTMLSelectElement).value as NonNullable<Target['technique']>;
  props.set.technique = type;
  if (type === 'standard') delete props.set.segments;
  else if (!props.set.segments)
    props.set.segments = [0, 1].map(() => ({
      reps: props.set.reps,
      tut: props.set.tut,
      load: props.set.load,
      restSeconds: type === 'cluster' ? 20 : 0,
    }));
}
</script>
<template>
  <div class="set-technique">
    <label
      >Tecnica serie<select :value="set.technique || 'standard'" @change="technique">
        <option value="standard">Standard</option>
        <option value="cluster">Cluster set</option>
        <option value="drop">Drop set</option>
      </select></label
    >
    <label
      >Recupero dopo la serie (secondi)<input
        v-model.number="set.restSeconds"
        type="number"
        min="0"
        max="3600"
        placeholder="90"
    /></label>
    <template v-if="set.technique === 'cluster' || set.technique === 'drop'">
      <p class="notice">
        {{
          set.technique === 'cluster'
            ? 'Blocchi della stessa serie con pause interne.'
            : 'Passaggi consecutivi: imposta carichi decrescenti, senza pausa interna.'
        }}
        Conta come una serie nel volume. Nei gruppi, il recupero finale segue il jump set o superset.
      </p>
      <div v-for="(part, i) in set.segments" :key="i" class="form-grid">
        <span>Passaggio {{ i + 1 }}</span>
        <label
          >{{ measurement === 'duration' ? 'Secondi' : 'Rep'
          }}<StableNumberInput
            :value="measurement === 'duration' ? part.tut : part.reps"
            min="1"
            max="2000"
            step="1"
            @commit="measurement === 'duration' ? (part.tut = $event) : (part.reps = $event)"
        /></label>
        <label
          >Kg<StableNumberInput :value="part.load" min="0" max="2000" step="0.5" @commit="part.load = $event"
        /></label>
        <label v-if="set.technique === 'cluster' && i < (set.segments?.length || 0) - 1"
          >Pausa interna (secondi)<input
            v-model.number="part.restSeconds"
            type="number"
            min="0"
            max="3600"
            required
        /></label>
        <button
          type="button"
          class="text-btn"
          :disabled="(set.segments?.length || 0) <= 2"
          @click="set.segments?.splice(i, 1)"
        >
          Rimuovi passaggio
        </button>
      </div>
      <button
        type="button"
        class="text-btn"
        :disabled="(set.segments?.length || 0) >= 10"
        @click="
          set.segments?.push({
            reps: set.reps,
            tut: set.tut,
            load: set.load,
            restSeconds: set.technique === 'cluster' ? 20 : 0,
          })
        "
      >
        + Passaggio
      </button>
    </template>
  </div>
</template>
