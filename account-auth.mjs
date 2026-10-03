const ORIGIN = 'https://bpijnoajcgwiicnfmrvw.supabase.co';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OPAQUE = /^[A-Za-z0-9_-]{43}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,95}$/;
const PLATFORMS = new Set(['darwin-arm64', 'darwin-x64', 'win32-x64']);
const HANDOFF_KEYS = ['redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'game_id', 'build_version', 'source_sha', 'platform'];

export class AccountError extends Error {
  constructor(code, message) { super(message); this.name = 'AccountError'; this.code = code; }
}
const invalidHandoff = () => new AccountError('invalid_handoff', 'This game sign-in link is invalid. Close this tab and try again from Mutation.');

export function readHandoff(search) {
  const query = new URLSearchParams(search);
  if (!HANDOFF_KEYS.some((key) => query.has(key))) return null;
  if ([...query.keys()].some((key) => ![...HANDOFF_KEYS, 'mode'].includes(key)) ||
      HANDOFF_KEYS.some((key) => query.getAll(key).length !== 1) || query.getAll('mode').length > 1) throw invalidHandoff();
  const value = Object.fromEntries(query);
  const redirect = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{3,4})\/oneblood\/callback$/.exec(value.redirect_uri);
  const port = redirect ? Number(redirect[1]) : 0;
  if (!redirect || port < 1024 || port > 65535 || !OPAQUE.test(value.state) ||
      !CHALLENGE.test(value.code_challenge) || value.code_challenge_method !== 'S256' ||
      value.game_id !== 'mutation' || !VERSION.test(value.build_version) ||
      !/^[0-9a-f]{40}$/.test(value.source_sha) || !PLATFORMS.has(value.platform) ||
      (value.mode !== undefined && !['signin', 'signup'].includes(value.mode))) throw invalidHandoff();
  return Object.freeze(value);
}

export function validUsername(value) { return typeof value === 'string' && /^[A-Za-z0-9 _.-]{2,32}$/.test(value.trim()); }
export function accountHandle(profile) { return profile.displayName + (profile.accountTag ? '#' + profile.accountTag : ''); }
export function normalizeSession(data, now = Date.now()) {
  if (!data || typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 16384 ||
      typeof data.refresh_token !== 'string' || !data.refresh_token || data.refresh_token.length > 16384 ||
      !data.user || !UUID.test(data.user.id) || typeof data.user.email !== 'string') return null;
  const expires = Number.isFinite(data.expires_at) ? data.expires_at :
      Number.isFinite(data.expires_in) ? Math.floor(now / 1000) + data.expires_in : 0;
  if (!Number.isFinite(expires) || expires <= 0) return null;
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: expires,
    user: { id: data.user.id, email: data.user.email } };
}
export function storeBrowserSession(next, remember, stores = globalThis) {
  const session = normalizeSession(next);
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const storage = stores[name], key = 'oneblood.browser.session.v1';
      if (session && name === (remember ? 'localStorage' : 'sessionStorage')) {
        const encoded = JSON.stringify(session); if (storage?.getItem(key) !== encoded) storage?.setItem(key, encoded);
      } else storage?.removeItem(key);
    } catch {}
  }
  return session;
}
export function restoreBrowserSession(stores = globalThis) {
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const session = normalizeSession(JSON.parse(stores[name]?.getItem('oneblood.browser.session.v1') || 'null'));
      if (session) return { session, remember: name === 'localStorage' };
    } catch {}
  }
  return { session: null, remember: true };
}
function profileFrom(data, userId) {
  if (!data || data.user_id !== userId || !UUID.test(data.user_id) ||
      typeof data.display_name !== 'string' || Array.from(data.display_name).length < 2 ||
      Array.from(data.display_name).length > 32 || /[\x00-\x1f\x7f-\x9f#\u061c\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/u.test(data.display_name) ||
      typeof data.account_tag !== 'string' || !/^[0-9]{4}$/.test(data.account_tag)) {
    throw new AccountError('profile_unavailable', 'Your Oneblood ID could not be loaded. Please try again.');
  }
  return { userId: data.user_id, displayName: data.display_name, accountTag: data.account_tag };
}
function serviceError(status, body, auth = false) {
  const code = typeof body?.error === 'string' ? body.error : body?.error?.code ?? body?.code ?? body?.error_code;
  if (status === 429) return new AccountError('rate_limited', 'Please wait a moment before trying again.');
  if (auth && (status === 400 || status === 401 || status === 422)) {
    if (code === 'email_not_confirmed') return new AccountError('confirmation_required', 'Confirm your email before signing in.');
    if (code === 'user_already_exists') return new AccountError('account_exists', 'An account already uses this email. Sign in instead.');
    return new AccountError('credentials_invalid', 'Check your email and password and try again.');
  }
  if (status === 401) return new AccountError('session_expired', 'Your session expired. Sign in again.');
  if (status === 409 || code === 'build_unavailable') return new AccountError('build_unavailable', 'This Mutation build is unavailable. Update the game and start sign-in again.');
  if (code === 'account_required') return new AccountError('account_required', 'Your Oneblood account is not available.');
  if (body?.message === 'username_invalid') return new AccountError('username_invalid', 'Use 2–32 letters, numbers, spaces, underscores, dots or hyphens.');
  return new AccountError('unavailable', 'Oneblood is unavailable. Check your connection and try again.');
}

export function createAccountClient(config, request = globalThis.fetch) {
  if (config?.url !== ORIGIN || typeof config.anonKey !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.anonKey)) {
    throw new AccountError('configuration_invalid', 'Oneblood account settings are unavailable. Please try again later.');
  }
  async function call(path, { method = 'POST', body, session, signal, auth = false } = {}) {
    const response = await request(ORIGIN + path, { method, signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { apikey: config.anonKey, 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session.access_token } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    let data;
    try { data = response.status === 204 ? {} : await response.json(); } catch { throw new AccountError('unavailable', 'Oneblood returned an invalid response. Please try again.'); }
    if (!response.ok) throw serviceError(response.status, data, auth);
    return data;
  }
  return {
    async signIn(email, password, signal) {
      const data = await call('/auth/v1/token?grant_type=password', { body: { email: email.trim(), password }, signal, auth: true });
      const session = normalizeSession(data);
      if (!session) throw new AccountError('unavailable', 'Oneblood returned an invalid session. Please try again.');
      return session;
    },
    async signUp(email, password, displayName, signal) {
      if (!validUsername(displayName)) throw new AccountError('username_invalid', 'Use 2–32 letters, numbers, spaces, underscores, dots or hyphens.');
      const data = await call('/auth/v1/signup', { body: { email: email.trim(), password, data: { display_name: displayName.trim() } }, signal, auth: true });
      return normalizeSession(data);
    },
    async refresh(session, signal) {
      let data;
      try { data = await call('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: session.refresh_token }, signal, auth: true }); }
      catch (error) {
        if (error instanceof AccountError && ['credentials_invalid', 'confirmation_required'].includes(error.code)) throw new AccountError('session_expired', 'Your session expired. Sign in again.');
        throw error;
      }
      const next = normalizeSession(data);
      if (!next || next.user.id !== session.user.id) throw new AccountError('session_expired', 'Your session expired. Sign in again.');
      return next;
    },
    async profile(session, signal) {
      const data = await call('/rest/v1/oneblood_profiles?select=user_id,display_name,account_tag&user_id=eq.' + session.user.id + '&limit=1', { method: 'GET', session, signal });
      if (!Array.isArray(data) || data.length !== 1) throw new AccountError('profile_unavailable', 'Your Oneblood ID could not be loaded. Please try again.');
      return profileFrom(data[0], session.user.id);
    },
    async rename(session, displayName, signal) {
      if (!validUsername(displayName)) throw new AccountError('username_invalid', 'Use 2–32 letters, numbers, spaces, underscores, dots or hyphens.');
      return profileFrom(await call('/rest/v1/rpc/oneblood_set_username', { body: { p_display_name: displayName.trim() }, session, signal }), session.user.id);
    },
    async signOut(session, signal) { await call('/auth/v1/logout', { session, signal }); },
    async issueTicket(session, handoff, signal) {
      // Revalidate at the boundary even when a caller already parsed the URL.
      const validated = readHandoff(new URLSearchParams(handoff).toString());
      if (!validated) throw invalidHandoff();
      const body = { game_id: validated.game_id, build_version: validated.build_version, source_sha: validated.source_sha,
        platform: validated.platform, code_challenge: validated.code_challenge, code_challenge_method: 'S256' };
      const data = await call('/functions/v1/issue-browser-ticket', { body, session, signal });
      const expires = Date.parse(data?.expires_at);
      if (!OPAQUE.test(data?.code ?? '') || !Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + 130000 ||
          ['game_id', 'build_version', 'source_sha', 'platform'].some((key) => data[key] !== body[key])) {
        throw new AccountError('unavailable', 'Oneblood could not authorize this game. Start sign-in again from Mutation.');
      }
      const callback = new URL(validated.redirect_uri);
      callback.searchParams.set('code', data.code); callback.searchParams.set('state', validated.state);
      return callback.href;
    },
  };
}
