// Open Mutation itself. No editor code is duplicated here.
const status = document.getElementById('editor-connection-status');
const open = document.getElementById('open-real-editor');
try {
  const response = await fetch(new URL('./editor-config.json', import.meta.url));
  if (!response.ok) throw new Error('Editor destination unavailable.');
  const {url} = await response.json();
  if (!url) {
    status.textContent = 'The online Creature Creator is not available yet. Come back soon to make your first creature.';
  } else {
    const destination = new URL(url, location.origin);
    if (!['http:', 'https:'].includes(destination.protocol) || destination.href === location.href) throw new Error('Invalid editor destination.');
    open.href = destination.href;
    open.hidden = false;
    status.textContent = 'Opening the original Mutation editor…';
    location.replace(destination.href);
  }
} catch {
  status.textContent = 'The editor could not be reached. Please try again shortly.';
}
