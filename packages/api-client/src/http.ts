import type { ApiErrorBody, PaginationMeta } from '@walktogether/shared-types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface TokenStore {
  getAccessToken(): string | null | Promise<string | null>;
  /** Native clients only. Web clients rely on the httpOnly refresh cookie. */
  getRefreshToken?(): string | null | Promise<string | null>;
  setTokens(tokens: { accessToken: string; refreshToken?: string }): void | Promise<void>;
  clear(): void | Promise<void>;
}

export interface HttpClientOptions {
  baseUrl: string;
  /** 'web' => refresh token lives in an httpOnly cookie; 'native' => refresh token kept in TokenStore. */
  mode: 'web' | 'native';
  tokens: TokenStore;
  /** Path of the refresh endpoint relative to baseUrl. */
  refreshPath: string;
  onSessionExpired?: () => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  auth?: boolean;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface Page<T> {
  items: T[];
  meta: PaginationMeta;
}

export class HttpClient {
  private refreshing: Promise<boolean> | null = null;

  constructor(private readonly opts: HttpClientOptions) {}

  private url(path: string, query?: RequestOptions['query']) {
    const u = new URL(path.replace(/^\//, ''), this.opts.baseUrl.endsWith('/') ? this.opts.baseUrl : `${this.opts.baseUrl}/`);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
    return u.toString();
  }

  private async raw(path: string, o: RequestOptions, accessToken: string | null) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.opts.mode === 'web') headers['X-WT-Client'] = 'web';
    if (accessToken && o.auth !== false) headers.Authorization = `Bearer ${accessToken}`;
    Object.assign(headers, o.headers ?? {});
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const timeout = AbortSignal.timeout(this.opts.timeoutMs ?? 20_000);
    return fetchImpl(this.url(path, o.query), {
      method: o.method ?? 'GET',
      headers,
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      credentials: this.opts.mode === 'web' ? 'include' : 'omit',
      signal: o.signal ?? timeout,
    });
  }

  /** Single-flight refresh: concurrent 401s share one refresh call (required by rotation + reuse detection). */
  refresh(): Promise<boolean> {
    this.refreshing ??= (async () => {
      try {
        const refreshToken = this.opts.mode === 'native' ? await this.opts.tokens.getRefreshToken?.() : undefined;
        if (this.opts.mode === 'native' && !refreshToken) return false;
        const res = await this.raw(this.opts.refreshPath, { method: 'POST', body: refreshToken ? { refreshToken } : {}, auth: false }, null);
        if (!res.ok) {
          await this.opts.tokens.clear();
          return false;
        }
        const json = (await res.json()) as { data: { accessToken: string; refreshToken?: string } };
        await this.opts.tokens.setTokens({ accessToken: json.data.accessToken, refreshToken: json.data.refreshToken });
        return true;
      } catch {
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private async parse<T>(res: Response): Promise<{ data: T; meta?: PaginationMeta }> {
    if (res.status === 204) return { data: undefined as T };
    const json = (await res.json().catch(() => null)) as ({ data: T; meta?: PaginationMeta } & Partial<ApiErrorBody>) | null;
    if (!res.ok) {
      const e = json?.error;
      throw new ApiError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? `Request failed with status ${res.status}`, e?.details, e?.requestId);
    }
    return json as { data: T; meta?: PaginationMeta };
  }

  async request<T>(path: string, o: RequestOptions = {}): Promise<T> {
    return (await this.requestWithMeta<T>(path, o)).data;
  }

  async requestWithMeta<T>(path: string, o: RequestOptions = {}): Promise<{ data: T; meta?: PaginationMeta }> {
    let res = await this.raw(path, o, await this.opts.tokens.getAccessToken());
    if (res.status === 401 && o.auth !== false) {
      if (await this.refresh()) {
        res = await this.raw(path, o, await this.opts.tokens.getAccessToken());
      } else {
        this.opts.onSessionExpired?.();
      }
    }
    return this.parse<T>(res);
  }

  /** Authenticated non-JSON download (CSV/GPX). */
  async text(path: string, o: RequestOptions = {}): Promise<string> {
    let res = await this.raw(path, o, await this.opts.tokens.getAccessToken());
    if (res.status === 401 && (await this.refresh())) res = await this.raw(path, o, await this.opts.tokens.getAccessToken());
    if (!res.ok) await this.parse(res);
    return res.text();
  }

  async page<T>(path: string, o: RequestOptions = {}): Promise<Page<T>> {
    const { data, meta } = await this.requestWithMeta<T[]>(path, o);
    return { items: data, meta: meta ?? { nextCursor: null, limit: data.length } };
  }
}
