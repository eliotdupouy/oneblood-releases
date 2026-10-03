import { AccountError, accountHandle, createAccountClient, normalizeSession, readHandoff, restoreBrowserSession, storeBrowserSession, validUsername } from './account-auth.mjs';

const element = (id) => document.getElementById(id);
let client, session = null, profile = null, handoff = null, busy = false, pending = null;
let generation = 0;
let mode = new URLSearchParams(location.search).get('mode') === 'signup' ? 'signup' : 'signin';
let handoffInvalid = false, handoffComplete = false;
try { handoff = readHandoff(location.search); }
catch (error) {
  handoffInvalid = true; element('handoff-error').textContent = error.message; element('handoff-error').hidden = false;
}

function showMessage(message = '', error = false) {
  const node = element('account-message'); node.textContent = message;
  node.classList.toggle('error', error); node.hidden = !message;
}
function saveSession(next) {
  session = storeBrowserSession(next, element('keep-signed-in').checked, window);
}
function render() {
  element('auth-view').hidden = !!session; element('profile-view').hidden = !session;
  element('account-title').textContent = session ? 'Your account' : mode === 'signup' ? 'Create account' : 'Sign in';
  element('account-subtitle').textContent = handoff ? 'Sign in to continue to Mutation.' : 'Your account for Mutation.';
  element('signup-name-field').hidden = mode !== 'signup'; element('signup-name').required = !session && mode === 'signup';
  element('signin-tab').setAttribute('aria-selected', String(mode === 'signin'));
  element('signup-tab').setAttribute('aria-selected', String(mode === 'signup'));
  element('password').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  element('password').minLength = mode === 'signup' ? 8 : 1;
  element('password').placeholder = mode === 'signup' ? 'At least 8 characters' : 'Your password';
  element('auth-submit').firstChild.textContent = busy ? 'Please wait… ' : mode === 'signup' ? 'Create account ' : 'Sign in ';
  element('profile-handle').textContent = profile ? accountHandle(profile) : '';
  element('profile-avatar').textContent = profile ? Array.from(profile.displayName)[0].toLocaleUpperCase() : '';
  element('profile-loading').hidden = !session || !!profile;
  element('profile-retry').hidden = !session || !!profile || busy;
  element('username-form').hidden = !profile;
  element('game-confirmation').hidden = !handoff || !profile || handoffComplete || handoffInvalid;
  element('game-complete').hidden = !handoffComplete;
  element('continue-game').firstChild.textContent = busy ? 'Connecting… ' : 'Continue to Mutation ';
  document.querySelector('.account-content').classList.toggle('is-busy', busy);
  document.querySelectorAll('.account-content input,.account-content button').forEach((node) => { node.disabled = busy || !client; });
  element('save-username').disabled = busy || !profile || !validUsername(element('profile-name').value) || element('profile-name').value.trim() === profile?.displayName;
}
async function run(operation) {
  if (busy || !client) return;
  const controller = new AbortController(); pending = controller;
  const context = generation;
  const timeout = setTimeout(() => controller.abort(), 12000);
  busy = true; showMessage(); render();
  try { await operation(controller.signal); }
  catch (error) {
    if (context !== generation) return;
    if (error instanceof AccountError && error.code === 'session_expired') { saveSession(null); profile = null; }
    showMessage(error instanceof AccountError ? error.message : controller.signal.aborted ? 'This request timed out. Please try again.' : 'Oneblood is unavailable. Check your connection and try again.', true);
  } finally {
    clearTimeout(timeout); if (pending === controller) pending = null;
    if (context === generation) { busy = false; render(); }
  }
}
function assertActive(signal) { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError'); }
async function currentSession(signal) {
  if (!session) throw new AccountError('session_expired', 'Your session expired. Sign in again.');
  if (session.expires_at * 1000 <= Date.now() + 60000) {
    const next = await client.refresh(session, signal); assertActive(signal); saveSession(next);
  }
  return session;
}
async function loadProfile(signal) {
  const next = await client.profile(await currentSession(signal), signal); assertActive(signal); profile = next;
  element('profile-name').value = profile.displayName; element('profile-tag').textContent = '#' + profile.accountTag;
}
function changeMode(next) {
  if (busy) return;
  mode = next; element('password').value = ''; showMessage(); render();
  (mode === 'signup' ? element('signup-name') : element('email')).focus();
}
element('signin-tab').addEventListener('click', () => changeMode('signin'));
element('signup-tab').addEventListener('click', () => changeMode('signup'));
element('show-password').addEventListener('click', () => {
  const show = element('password').type === 'password'; element('password').type = show ? 'text' : 'password';
  element('show-password').setAttribute('aria-pressed', String(show));
  element('show-password').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});
element('auth-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void run(async (signal) => {
    const email = element('email').value.trim(), password = element('password').value, name = element('signup-name').value;
    // Never persist a password or leave it in the DOM while a request runs.
    element('password').value = '';
    if (mode === 'signup' && !validUsername(name)) { element('signup-name').focus(); throw new AccountError('username_invalid', 'Use 2–32 letters, numbers, spaces, underscores, dots or hyphens.'); }
  const next = mode === 'signup' ? await client.signUp(email, password, name, signal) : await client.signIn(email, password, signal);
    assertActive(signal);
    if (!next) { showMessage('Check your email to confirm your account, then sign in.'); return; }
    saveSession(next); await loadProfile(signal);
    showMessage(handoff ? 'Your account is ready. Continue to Mutation below.' : 'Signed in.');
  });
});
element('profile-name').addEventListener('input', () => { showMessage(); render(); });
element('username-form').addEventListener('submit', (event) => {
  event.preventDefault(); void run(async (signal) => {
    const next = await client.rename(await currentSession(signal), element('profile-name').value, signal); assertActive(signal); profile = next;
    element('profile-name').value = profile.displayName; element('profile-tag').textContent = '#' + profile.accountTag;
    showMessage('Username saved.');
  });
});
element('profile-retry').addEventListener('click', () => { void run(loadProfile); });
element('signout').addEventListener('click', () => {
  void run(async (signal) => {
    const previous = session; saveSession(null); profile = null; handoffComplete = false;
    element('profile-name').value = ''; element('email').value = ''; element('password').value = '';
    if (previous) { try { await client.signOut(previous, signal); } catch {} }
    showMessage('Signed out.');
  });
});
async function continueGame(signal) {
  if (!handoff || handoffInvalid || !profile) return;
  await loadProfile(signal); // Confirm the canonical account again before issuing a ticket.
  const callback = await client.issueTicket(await currentSession(signal), handoff, signal);
  assertActive(signal);
  handoffComplete = true; render();
  location.assign(callback);
}
element('continue-game').addEventListener('click', () => { void run(continueGame); });
element('retry-game').addEventListener('click', () => { void run(continueGame); });
window.addEventListener('pagehide', () => { pending?.abort(); element('password').value = ''; });
window.addEventListener('storage', (event) => {
  if ((event.key !== 'oneblood.browser.session.v1' && event.key !== null) || !element('keep-signed-in').checked) return;
  pending?.abort(); pending = null; generation++; busy = false; profile = null; handoffComplete = false;
  try { session = normalizeSession(JSON.parse(event.newValue || 'null')); } catch { session = null; }
  element('password').value = ''; element('profile-name').value = ''; showMessage(); render();
  if (session && client) void run(loadProfile);
});

render();
try {
  const response = await fetch(new URL('./account-config.json', import.meta.url), { cache: 'no-store', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error();
  client = createAccountClient(await response.json());
  const restored = restoreBrowserSession(window);
  element('keep-signed-in').checked = restored.remember;
  saveSession(restored.session);
  render();
  if (session) await run(loadProfile);
} catch { showMessage('Oneblood account settings could not be loaded. Refresh this page to try again.', true); }
