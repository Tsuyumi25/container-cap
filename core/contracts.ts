export interface Tab {
  id: number;
  cookieStoreId?: string;
  incognito?: boolean;
}

export interface Container {
  cookieStoreId: string;
  name: string;
  color: string;
}

export interface Settings {
  defaultLimit: number;
  limits: Record<string, number>;
}

export interface Session {
  enabled: boolean;
  blocked: number;
  error: string | null;
}

export interface ContainerStatus extends Container {
  count: number;
  limit: number;
  overridden: boolean;
}

export interface Snapshot extends Session {
  defaultLimit: number;
  containers: ContainerStatus[];
}

export type Request =
  | { type: 'status' }
  | { type: 'set-enabled'; enabled: boolean }
  | { type: 'set-default-limit'; limit: number }
  | { type: 'set-container-limit'; cookieStoreId: string; limit: number | null };

export type Response =
  | { ok: true; state: Snapshot }
  | { ok: false; error: string };

export interface LimiterPort {
  tabs(): Promise<Tab[]>;
  containers(): Promise<Container[]>;
  close(tabId: number): Promise<void>;
  restoreToken(tabId: number): Promise<string | undefined>;
  remember(tabId: number, token: string): Promise<void>;
  settings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  session(): Promise<Session>;
  saveSession(session: Session): Promise<void>;
}
