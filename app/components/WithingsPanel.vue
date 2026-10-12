<script setup lang="ts">
defineProps<{
  info: {
    configured: boolean
    connected: boolean
    lastSync?: string
    notifications?: boolean
    pending?: boolean
    error?: string
  }
  loading: boolean
  message: string
  checked: boolean
  online: boolean
  local: boolean
}>()
defineEmits<{ connect: []; sync: []; disconnect: [] }>()
</script>
<template>
  <section class="panel withings-panel">
    <div class="panel-title">
      <h2>Il peso, in sintonia.</h2>
      <span class="text-lime">WITHINGS</span>
    </div>
    <p class="subtle">
      Le tue pesate arrivano nel diario con data e ora. L’ultimo peso viene suggerito per il
      prossimo allenamento.
    </p>
    <p v-if="local" class="notice">Accedi con il tuo account Gymbrain per collegare la bilancia.</p>
    <p v-else-if="!online" class="notice">Sei offline. I pesi già salvati restano disponibili.</p>
    <p v-else-if="!checked" class="notice">
      {{ loading ? 'Controllo del collegamento…' : 'Collegamento da verificare.' }}
    </p>
    <p v-else-if="!info.configured" class="notice">
      L’integrazione è pronta. Il gestore deve completare la configurazione Withings.
    </p>
    <template v-else>
      <p v-if="info.connected" class="text-lime">Account collegato</p>
      <p v-if="info.lastSync" class="subtle">
        Ultimo aggiornamento: {{ new Date(info.lastSync).toLocaleString('it-IT') }}
      </p>
      <p v-if="info.connected && !info.notifications" class="notice">
        Aggiornamento all’apertura e su richiesta. L’attivazione delle notifiche automatiche verrà
        ritentata.
      </p>
      <p v-if="info.error" class="notice">{{ info.error }}</p>
      <div class="button-group">
        <button
          v-if="!info.connected"
          class="primary"
          :disabled="loading"
          @click="$emit('connect')"
        >
          Collega Withings ↗
        </button>
        <button v-else class="primary" :disabled="loading" @click="$emit('sync')">
          {{ loading ? 'Sincronizzazione…' : 'Sincronizza pesate' }}
        </button>
        <button
          v-if="info.connected"
          class="text-btn"
          :disabled="loading"
          @click="$emit('disconnect')"
        >
          Scollega
        </button>
      </div>
    </template>
    <p v-if="message" class="notice" role="status">{{ message }}</p>
    <button
      v-if="!local && online && !checked && !loading"
      class="secondary"
      @click="$emit('sync')"
    >
      Riprova
    </button>
    <p class="subtle">
      Le sessioni concluse conservano il peso registrato. Puoi continuare a inserire pesate manuali.
    </p>
  </section>
</template>
