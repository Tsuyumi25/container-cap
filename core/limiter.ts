import type { LimiterPort, Snapshot, Tab } from './contracts.ts';

function assertLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('上限必須是大於 0 的整數。');
  }
}

function isContainerTab(tab: Tab): boolean {
  return !tab.incognito && Boolean(tab.cookieStoreId)
    && tab.cookieStoreId !== 'firefox-default'
    && tab.cookieStoreId !== 'firefox-private';
}

export class ContainerLimiter {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = new Set<number>();
  private protectedTabs = new Set<number>();
  private tokenOwners = new Map<string, number>();
  private fault: string | null = null;
  private port: LimiterPort;

  constructor(port: LimiterPort) {
    this.port = port;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const job = this.tail.then(operation);
    this.tail = job.catch(() => undefined);
    return job;
  }

  private async snapshot(): Promise<Snapshot> {
    const [tabs, containers, settings, session] = await Promise.all([
      this.port.tabs(), this.port.containers(), this.port.settings(), this.port.session(),
    ]);
    const counts = new Map<string, number>();
    for (const tab of tabs) {
      if (isContainerTab(tab)) {
        const id = tab.cookieStoreId!;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return {
      ...session,
      enabled: session.enabled && this.fault === null,
      error: this.fault ?? session.error,
      defaultLimit: settings.defaultLimit,
      containers: containers.map(container => ({
        ...container,
        count: counts.get(container.cookieStoreId) ?? 0,
        limit: settings.limits[container.cookieStoreId] ?? settings.defaultLimit,
        overridden: Object.hasOwn(settings.limits, container.cookieStoreId),
      })),
    };
  }

  status(): Promise<Snapshot> {
    return this.enqueue(() => this.snapshot());
  }

  initialize(): Promise<void> {
    return this.enqueue(async () => {
      const tabs = await this.port.tabs();
      this.tokenOwners.clear();
      for (const tab of tabs) {
        if (!isContainerTab(tab) || this.pending.has(tab.id)) continue;
        const token = await this.port.restoreToken(tab.id);
        if (token && !this.tokenOwners.has(token)) {
          this.tokenOwners.set(token, tab.id);
        } else {
          const replacement = crypto.randomUUID();
          await this.port.remember(tab.id, replacement);
          this.tokenOwners.set(replacement, tab.id);
        }
        this.protectedTabs.add(tab.id);
      }
    });
  }

  setEnabled(enabled: boolean): Promise<Snapshot> {
    return this.enqueue(async () => {
      if (enabled) {
        const tabs = await this.port.tabs();
        this.protectedTabs = new Set(tabs.map(tab => tab.id));
      }
      const session = await this.port.session();
      await this.port.saveSession({ ...session, enabled, error: null });
      this.fault = null;
      return this.snapshot();
    });
  }

  setDefaultLimit(limit: number): Promise<Snapshot> {
    return this.enqueue(async () => {
      assertLimit(limit);
      const settings = await this.port.settings();
      await this.port.saveSettings({ ...settings, defaultLimit: limit });
      return this.snapshot();
    });
  }

  setContainerLimit(cookieStoreId: string, limit: number | null): Promise<Snapshot> {
    return this.enqueue(async () => {
      if (limit !== null) assertLimit(limit);
      const containers = await this.port.containers();
      if (!containers.some(container => container.cookieStoreId === cookieStoreId)) {
        throw new Error('找不到這個 container，請重新整理清單。');
      }
      const settings = await this.port.settings();
      const limits = { ...settings.limits };
      if (limit === null) delete limits[cookieStoreId];
      else limits[cookieStoreId] = limit;
      await this.port.saveSettings({ ...settings, limits });
      return this.snapshot();
    });
  }

  created(tab: Tab): Promise<void> {
    if (!isContainerTab(tab) || this.pending.has(tab.id)) return Promise.resolve();
    this.pending.add(tab.id);
    return this.enqueue(async () => {
      try {
        const session = await this.port.session();
        const [tabs, settings] = await Promise.all([this.port.tabs(), this.port.settings()]);
        const current = tabs.find(candidate => candidate.id === tab.id);
        if (!current || !isContainerTab(current)) return;
        const token = await this.port.restoreToken(tab.id);
        const liveIds = new Set(tabs.map(candidate => candidate.id));
        for (const [knownToken, owner] of this.tokenOwners) {
          if (!liveIds.has(owner)) this.tokenOwners.delete(knownToken);
        }
        const owner = token ? this.tokenOwners.get(token) : undefined;
        if (token && (owner === undefined || owner === tab.id)) {
          this.tokenOwners.set(token, tab.id);
          return;
        }
        if (!session.enabled || this.fault !== null || this.protectedTabs.has(tab.id)) {
          const replacement = crypto.randomUUID();
          await this.port.remember(tab.id, replacement);
          this.tokenOwners.set(replacement, tab.id);
          return;
        }
        const store = current.cookieStoreId!;
        const limit = settings.limits[store] ?? settings.defaultLimit;
        assertLimit(limit);
        let occupied = 0;
        for (const candidate of tabs) {
          if (isContainerTab(candidate) && candidate.cookieStoreId === store
              && !this.pending.has(candidate.id)) occupied++;
        }
        if (occupied < limit) {
          const replacement = crypto.randomUUID();
          await this.port.remember(tab.id, replacement);
          this.tokenOwners.set(replacement, tab.id);
          return;
        }
        await this.port.close(tab.id);
        await this.port.saveSession({ ...session, blocked: session.blocked + 1 });
      } catch (cause) {
        this.fault = cause instanceof Error ? cause.message : String(cause);
        const session = await this.port.session();
        await this.port.saveSession({ ...session, enabled: false, error: this.fault });
        throw cause;
      } finally {
        this.pending.delete(tab.id);
      }
    });
  }
}
