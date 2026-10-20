// Amazon API access: Login with Amazon token, SP-API and Ads API calls. Read-only: only GET plus the report-request POSTs.
// Tokens live in memory only. Error messages carry the status and Amazon's error text, never a credential.

export type Creds = {
  spClientId: string; spClientSecret: string; spRefreshToken: string;
  adsClientId?: string; adsClientSecret?: string; adsRefreshToken?: string; adsProfileId?: string;
};

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const SP_BASE = "https://sellingpartnerapi-na.amazon.com";
const ADS_BASE = "https://advertising-api.amazon.com";
export const MARKETPLACE_US = "ATVPDKIKX0DER";

/** Settings from the environment (SELLERFIELD_SP_* and SELLERFIELD_ADS_*); Ads is optional. */
export function credsFromEnv(env: Record<string, string | undefined> = process.env): Creds {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`${k} is not set`);
    return v;
  };
  return {
    spClientId: need("SELLERFIELD_SP_CLIENT_ID"), spClientSecret: need("SELLERFIELD_SP_CLIENT_SECRET"), spRefreshToken: need("SELLERFIELD_SP_REFRESH_TOKEN"),
    adsClientId: env.SELLERFIELD_ADS_CLIENT_ID, adsClientSecret: env.SELLERFIELD_ADS_CLIENT_SECRET,
    adsRefreshToken: env.SELLERFIELD_ADS_REFRESH_TOKEN, adsProfileId: env.SELLERFIELD_ADS_PROFILE_ID,
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Amazon {
  private tokens = new Map<string, { value: string; until: number }>();
  /** `pause` is injectable so tests do not wait on throttling or report polling. */
  constructor(readonly creds: Creds, readonly fetchFn: Fetch = fetch, readonly pause: (ms: number) => Promise<void> = sleep) {}

  get hasAds() {
    const c = this.creds;
    return !!(c.adsClientId && c.adsClientSecret && c.adsRefreshToken && c.adsProfileId);
  }

  private async token(kind: "sp" | "ads"): Promise<string> {
    const hit = this.tokens.get(kind);
    if (hit && hit.until > Date.now() + 60_000) return hit.value;
    const c = this.creds;
    const [id, secret, refresh] = kind === "sp" ? [c.spClientId, c.spClientSecret, c.spRefreshToken] : [c.adsClientId, c.adsClientSecret, c.adsRefreshToken];
    const res = await this.fetchFn("https://api.amazon.com/auth/o2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh!, client_id: id!, client_secret: secret! }).toString(),
    });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !j.access_token) throw new Error(`Amazon login (${kind}) failed: ${res.status} ${j.error ?? ""} ${j.error_description ?? ""}`.trim());
    this.tokens.set(kind, { value: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 });
    return j.access_token;
  }

  /** Call with up to 5 retries on 429 and 5xx. */
  private async call(kind: "sp" | "ads", url: string, init: RequestInit & { headers?: Record<string, string> }): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const access = await this.token(kind);
      const headers: Record<string, string> =
        kind === "sp"
          ? { "x-amz-access-token": access, ...init.headers }
          : { authorization: `Bearer ${access}`, "Amazon-Advertising-API-ClientId": this.creds.adsClientId!, "Amazon-Advertising-API-Scope": this.creds.adsProfileId!, ...init.headers };
      const res = await this.fetchFn(url, { ...init, headers });
      if ((res.status === 429 || res.status >= 500) && attempt < 5) {
        await this.pause(Math.min(2000 * 2 ** attempt, 30_000));
        continue;
      }
      if (!res.ok) throw new Error(`Amazon ${kind} ${init.method ?? "GET"} ${new URL(url).pathname} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
      return res;
    }
  }

  async sp(method: "GET" | "POST", path: string, query: Record<string, string> = {}, body?: unknown): Promise<any> {
    const qs = new URLSearchParams(query).toString();
    const res = await this.call("sp", `${SP_BASE}${path}${qs ? `?${qs}` : ""}`, {
      method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  }

  async ads(method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
    const type = "application/vnd.createasyncreportrequest.v3+json";
    const res = await this.call("ads", `${ADS_BASE}${path}`, {
      method, headers: body ? { "content-type": type, accept: type } : {}, body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  }

  /** Download a pre-signed report URL (no Amazon headers), gunzip when it is gzip. */
  async download(url: string): Promise<string> {
    const res = await this.fetchFn(url);
    if (!res.ok) throw new Error(`report download failed: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const gz = bytes[0] === 0x1f && bytes[1] === 0x8b;
    return new TextDecoder().decode(gz ? Bun.gunzipSync(bytes) : bytes);
  }
}
