<script setup lang="ts">
import type { Target, Prescription } from '../../shared/domain';
import { setAssistance } from '../../shared/setDefaults';
const props = defineProps<{
  sets: Target[];
  index: number;
  fallback?: Prescription['assistance'];
  disabled?: boolean;
}>();
const emit = defineEmits<{ change: [] }>();
const open = ref(false);
const bands = ref<Prescription['assistance']>([]);
const effective = computed(() => setAssistance(props.sets, props.index, props.fallback));
function edit() {
  bands.value = structuredClone(toRaw(effective.value));
  open.value = true;
}
function confirm() {
  props.sets[props.index]!.assistance = structuredClone(toRaw(bands.value));
  emit('change');
  open.value = false;
}
function inherit() {
  delete props.sets[props.index]!.assistance;
  emit('change');
  open.value = false;
}
</script>
<template>
  <div class="set-assistance">
    <button
      type="button"
      class="text-btn"
      :disabled="disabled"
      :aria-label="'Elastico serie ' + (index + 1)"
      @click="edit"
    >
      Elastico: {{ effective.length ? effective.map((b) => b.name).join(', ') : 'nessuno' }}
    </button>
    <Teleport to="body"
      ><AppModal :open="open" :title="'ELASTICO SERIE ' + (index + 1)" @close="open = false">
        <AssistancePicker v-model="bands" />
        <div class="button-group">
          <button v-if="index > 0" type="button" class="text-btn" @click="inherit">Usa prima serie</button
          ><button type="button" class="secondary" @click="open = false">Annulla</button
          ><button type="button" class="primary" @click="confirm">Conferma</button>
        </div>
      </AppModal></Teleport
    >
  </div>
</template>
