<script setup lang="ts">
defineOptions({ inheritAttrs: false });
const props = defineProps<{ value?: number | null }>();
const emit = defineEmits<{ commit: [value: number | null] }>();
const attrs = useAttrs();
const format = (value?: number | null) => value == null ? '' : String(value).replace('.', ',');
const buffer = ref(format(props.value));
const focused = ref(false);
const input = ref<HTMLInputElement>();
watch(
  () => props.value,
  (value) => {
    if (!focused.value) buffer.value = format(value);
  },
);
function commit() {
  const raw = buffer.value.trim().replace(',', '.');
  const number = raw === '' ? null : Number(raw);
  const valid =
    raw === ''
      ? !('required' in attrs && attrs.required !== false)
      : /^\d+(?:\.\d*)?$/.test(raw) &&
        Number.isFinite(number) &&
        (attrs.min == null || number! >= Number(attrs.min)) &&
        (attrs.max == null || number! <= Number(attrs.max));
  input.value?.setCustomValidity(valid ? '' : 'Inserisci un numero valido nei limiti indicati.');
  if (!valid) {
    input.value?.reportValidity();
    return;
  }
  emit('commit', number);
}
</script>
<template>
  <input
    ref="input"
    v-bind="$attrs"
    v-model="buffer"
    type="text"
    inputmode="decimal"
    @focus="focused = true"
    @input="input?.setCustomValidity('')"
    @blur="
      focused = false;
      commit();
    "
    @keydown.enter.prevent="
      commit();
      input?.blur();
    "
  />
</template>
