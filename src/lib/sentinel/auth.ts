import type { CachedToken, Credentials } from "@/types/sentinel";
import { CDSE_TOKEN_URL } from "./endpoints";

const CRED_KEY = "sentipede:credentials";
const TOKEN_KEY = "sentipede:token";
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export function loadCredentials(): Credentials | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(CRED_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Credentials;
    if (!parsed.clientId || !parsed.clientSecret) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCredentials(c: Credentials): void {
  try {
    const previous = localStorage.getItem(CRED_KEY);
    if (previous) {
      const old = JSON.parse(previous) as Partial<Credentials>;
      if (old.clientId && old.clientId !== c.clientId) {
        // A token from another client is invalid for this one.
        localStorage.removeItem(TOKEN_KEY);
      }
    }
  } catch {
    localStorage.removeItem(TOKEN_KEY);
  }
  localStorage.setItem(CRED_KEY, JSON.stringify(c));
}

export function clearCredentials(): void {
  localStorage.removeItem(CRED_KEY);
  localStorage.removeItem(TOKEN_KEY);
}

function loadCachedToken(): CachedToken | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CachedToken>;
    if (typeof parsed.accessToken !== "string" || !parsed.accessToken) {
      return null;
    }
    if (typeof parsed.expiresAt !== "number" || !Number.isFinite(parsed.expiresAt)) {
      return null;
    }
    if (parsed.expiresAt - Date.now() < REFRESH_MARGIN_MS) return null;
    return parsed as CachedToken;
  } catch {
    return null;
  }
}

function saveToken(token: CachedToken): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
}

let tokenPromise: Promise<string> | null = null;
let tokenPromiseKey = "";

export async function getAccessToken(creds: Credentials): Promise<string> {
  const cached = loadCachedToken();
  if (cached) return cached.accessToken;

  const key = `${creds.clientId}:${creds.clientSecret.slice(-6)}`;
  if (tokenPromise && tokenPromiseKey === key) return tokenPromise;

  tokenPromiseKey = key;
  tokenPromise = (async () => {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });

  const res = await fetch(CDSE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OAuth failed: ${res.status} ${res.statusText} ${text}`);
  }

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new Error("OAuth response did not include an access token.");
  }
  const expiresIn =
    typeof data.expires_in === "number" &&
    Number.isFinite(data.expires_in) &&
    data.expires_in > 0
      ? data.expires_in
      : 3600;
  const token: CachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  saveToken(token);
  return token.accessToken;
  })();
  try {
    return await tokenPromise;
  } finally {
    tokenPromise = null;
  }
}
