<script setup lang="ts">
import type { Target } from '../../shared/domain';
const props = defineProps<{ set: Target; measurement?: string }>();
const groupName = useId();
function technique(type: NonNullable<Target['technique']>) {
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
    <fieldset class="exercise-choices">
      <legend>Tipo di set</legend>
      <div class="exercise-choice-options">
        <label
          v-for="option in [
            ['standard', 'Standard'],
            ['cluster', 'Cluster set'],
            ['drop', 'Drop set'],
          ] as const"
          :key="option[0]"
          ><input
            type="radio"
            :name="groupName"
            :checked="(set.technique || 'standard') === option[0]"
            @change="technique(option[0])"
          /><span>{{ option[1] }}</span></label
        >
      </div>
    </fieldset>
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
          class="icon-btn danger"
          :disabled="(set.segments?.length || 0) <= 2"
          @click="set.segments?.splice(i, 1)"
          aria-label="Rimuovi passaggio"
          title="Rimuovi passaggio"
        >
          <GIcon name="trash" :size="18" />
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
