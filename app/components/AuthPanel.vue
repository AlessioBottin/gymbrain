<script setup lang="ts">
import type { SupabaseClient } from '@supabase/supabase-js'
const props = defineProps<{ client: SupabaseClient | null; recovery: boolean; allowLocal: boolean }>()
const emit = defineEmits<{ local: []; recovered: [] }>()
const mode = ref<'login' | 'signup' | 'reset'>('login'),
  email = ref(''),
  password = ref(''),
  name = ref(''),
  busy = ref(false),
  message = ref(''),
  error = ref('')
async function submit() {
  if (!props.client) return
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    if (props.recovery) {
      const { error: e } = await props.client.auth.updateUser({ password: password.value })
      if (e) throw e
      emit('recovered')
      return
    }
    if (mode.value === 'login') {
      const { error: e } = await props.client.auth.signInWithPassword({
        email: email.value,
        password: password.value,
      })
      if (e) throw e
    }
    if (mode.value === 'signup') {
      const { data, error: e } = await props.client.auth.signUp({
        email: email.value,
        password: password.value,
        options: { data: { display_name: name.value }, emailRedirectTo: location.origin },
      })
      if (e) throw e
      if (!data.session) message.value = 'Controlla la tua email per confermare l’account.'
    }
    if (mode.value === 'reset') {
      const { error: e } = await props.client.auth.resetPasswordForEmail(email.value, {
        redirectTo: location.origin,
      })
      if (e) throw e
      message.value = 'Se l’indirizzo è registrato, riceverai il link di recupero.'
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Accesso non riuscito'
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div class="auth-layout">
    <section class="auth-story">
      <a class="brand" href="/"><img src="/favicon.svg" alt="" />gymbrain<span>®</span></a>
      <div>
        <span class="eyebrow">IL TUO RITMO. IL TUO PERCORSO.</span>
        <h1>Il prossimo livello<br />comincia <em>da te.</em></h1>
        <p>
          Ogni movimento, ogni serie, ogni piccolo progresso.<br />Un solo spazio per costruire la tua forza.
        </p>
      </div>
      <div class="auth-orbit orb" aria-hidden="true"><i v-for="i in 6" :key="i" /></div>
      <span class="eyebrow">FORZA · CONSAPEVOLEZZA · COSTANZA</span>
    </section>
    <section class="auth-form">
      <span class="eyebrow">BENVENUTO NEL TUO SPAZIO</span>
      <h2>
        {{
          recovery
            ? 'Una nuova password.'
            : mode === 'signup'
              ? 'Il tuo percorso inizia qui.'
              : mode === 'reset'
                ? 'Ritrova il tuo accesso.'
                : 'Bentornato.'
        }}
      </h2>
      <p class="subtle">Schede e progressi personali, anche quando sei offline.</p>
      <form v-if="client" @submit.prevent="submit">
        <label v-if="mode === 'signup' && !recovery"
          >Come ti chiami?<input v-model="name" autocomplete="given-name" maxlength="60" required /></label
        ><label v-if="!recovery"
          >Email<input v-model="email" type="email" autocomplete="email" required /></label
        ><label v-if="mode !== 'reset' || recovery"
          >Password<input
            v-model="password"
            type="password"
            :autocomplete="mode === 'signup' || recovery ? 'new-password' : 'current-password'"
            minlength="8"
            maxlength="128"
            required /></label
        ><button class="primary" :disabled="busy" type="submit">
          {{
            busy
              ? 'Un momento…'
              : recovery
                ? 'Aggiorna password'
                : mode === 'signup'
                  ? 'Crea account'
                  : mode === 'reset'
                    ? 'Invia link'
                    : 'Entra nel tuo spazio'
          }}
          <GIcon name="arrow" />
        </button>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <p v-if="message" class="success" role="status">{{ message }}</p>
      </form>
      <p v-else class="notice setup-notice">
        Il collegamento a Supabase è in configurazione. Puoi già usare l’app sul dispositivo: i dati di questa
        modalità restano separati dagli account.
      </p>
      <div v-if="!recovery" class="auth-links">
        <button
          v-if="client"
          class="text-btn"
          @click="mode = mode === 'signup' ? 'login' : 'signup'; error = ''; message = ''"
        >
          {{ mode === 'signup' ? 'Hai già un account? Accedi' : 'Non hai un account? Registrati' }}</button
        ><button
          v-if="client && mode !== 'reset'"
          class="text-btn"
          @click="mode = 'reset'; error = ''; message = ''"
        >
          Password dimenticata?</button
        ><button v-if="allowLocal" class="secondary" @click="emit('local')">Prova sul dispositivo</button
        ><span class="notice">La modalità locale non sincronizza con altri dispositivi.</span>
      </div>
    </section>
  </div>
</template>
