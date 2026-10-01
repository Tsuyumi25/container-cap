<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue';
import { browser } from 'wxt/browser';
import type { Request, Response, Snapshot } from '../../core/contracts';

const state = ref<Snapshot | null>(null);
const busy = ref(false);
const error = ref('');
const defaultDraft = ref('100');
const drafts = reactive<Record<string, string>>({});
let sequence = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
let pendingWrites = 0;

async function request(message: Request, resetDraft?: string): Promise<void> {
  const ticket = ++sequence;
  try {
    const response: Response = await browser.runtime.sendMessage(message);
    if (disposed || ticket !== sequence) return;
    if (!response?.ok) throw new Error(response?.error ?? '背景程式未回應，請重新載入插件。');
    const previous = state.value;
    const first = previous === null;
    state.value = response.state;
    if (first || (message.type === 'set-default-limit' && Number(defaultDraft.value) === message.limit)) {
      defaultDraft.value = String(response.state.defaultLimit);
    }
    for (const container of response.state.containers) {
      const id = container.cookieStoreId;
      const prior = previous?.containers.find(item => item.cookieStoreId === id);
      const unchanged = prior && Number(drafts[id]) === prior.limit;
      const saved = message.type === 'set-container-limit' && message.cookieStoreId === id
        && (message.limit === null ? unchanged : Number(drafts[id]) === message.limit);
      if (!(id in drafts) || saved || (resetDraft === 'default' && !container.overridden && unchanged)) {
        drafts[id] = String(container.limit);
      }
    }
    error.value = '';
  } catch (cause) {
    if (!disposed && ticket === sequence) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  }
}

function scheduleRefresh(): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (busy.value) scheduleRefresh();
    else void request({ type: 'status' });
  }, 150);
}

async function mutate(message: Request, resetDraft?: string): Promise<void> {
  pendingWrites++;
  busy.value = true;
  clearTimeout(timer);
  try {
    await request(message, resetDraft);
  } finally {
    pendingWrites--;
    busy.value = pendingWrites > 0;
  }
}

async function saveLimit(event: Event, id?: string): Promise<void> {
  const raw = (event.target as HTMLInputElement).value;
  if (id) drafts[id] = raw;
  else defaultDraft.value = raw;
  if (raw === '') {
    error.value = '';
    return;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    error.value = '上限必須是大於 0 的整數。';
    return;
  }
  await mutate(id
    ? { type: 'set-container-limit', cookieStoreId: id, limit: value }
    : { type: 'set-default-limit', limit: value }, id ?? 'default');
}

onMounted(() => {
  void request({ type: 'status' });
  browser.tabs.onCreated.addListener(scheduleRefresh);
  browser.tabs.onRemoved.addListener(scheduleRefresh);
  browser.contextualIdentities.onCreated.addListener(scheduleRefresh);
  browser.contextualIdentities.onRemoved.addListener(scheduleRefresh);
  browser.contextualIdentities.onUpdated.addListener(scheduleRefresh);
  browser.storage.onChanged.addListener(scheduleRefresh);
});

onUnmounted(() => {
  disposed = true;
  clearTimeout(timer);
  browser.tabs.onCreated.removeListener(scheduleRefresh);
  browser.tabs.onRemoved.removeListener(scheduleRefresh);
  browser.contextualIdentities.onCreated.removeListener(scheduleRefresh);
  browser.contextualIdentities.onRemoved.removeListener(scheduleRefresh);
  browser.contextualIdentities.onUpdated.removeListener(scheduleRefresh);
  browser.storage.onChanged.removeListener(scheduleRefresh);
});
</script>

<template>
  <main>
    <header>
      <h1>Container Cap</h1>
      <div v-if="state" class="activation">
        <span class="muted">{{ state.enabled ? '已啟用' : '已暫停' }}</span>
        <button type="button" :aria-pressed="state.enabled"
          @click="mutate({ type: 'set-enabled', enabled: !state.enabled })">
          {{ state.enabled ? '暫停' : '啟用' }}
        </button>
      </div>
    </header>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="!state" class="empty">正在讀取 container…</p>
    <template v-else>
      <p v-if="state.error" role="alert" class="error">限制已暫停：{{ state.error }}</p>
      <div class="default-limit">
        <label for="default-limit">預設上限</label>
        <input id="default-limit" :value="defaultDraft" type="number" min="1" step="1" required
          @input="saveLimit($event)" />
      </div>
      <table v-if="state.containers.length">
        <colgroup><col /><col class="count-column" /><col class="limit-column" /><col class="reset-column" /></colgroup>
        <thead>
          <tr><th scope="col">Container</th><th scope="col" class="number">已開啟</th><th scope="col" class="number">上限</th><th scope="col"><span class="sr-only">重設</span></th></tr>
        </thead>
        <tbody>
          <tr v-for="container in state.containers" :key="container.cookieStoreId">
            <th scope="row">
              <label :for="container.cookieStoreId" :title="container.name">{{ container.name }}</label>
            </th>
            <td class="number" :class="{ full: container.count >= container.limit }">{{ container.count }}</td>
            <td>
              <input :id="container.cookieStoreId" :value="drafts[container.cookieStoreId]"
                :aria-label="`${container.name} 的上限`"
                :title="container.overridden ? '個別上限' : '沿用預設上限'"
                type="number" min="1" step="1" required @input="saveLimit($event, container.cookieStoreId)" />
            </td>
            <td class="reset">
              <button v-if="container.overridden" type="button" class="text-button"
                :aria-label="`${container.name} 改用預設上限`"
                @click="mutate({ type: 'set-container-limit', cookieStoreId: container.cookieStoreId, limit: null }, container.cookieStoreId)">
                預設
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">尚無 container。</p>
    </template>
    <button v-if="error || !state" type="button" class="text-button" :disabled="busy"
      @click="request({ type: 'status' })">重新整理</button>
  </main>
</template>
