// Native links remain functional without JavaScript.
fetch(new URL('./editor-config.json', import.meta.url)).then(response => response.ok ? response.json() : null).then(config => {
  if (!config?.url) return;
  const url = new URL(config.url, location.origin);
  if (!['http:', 'https:'].includes(url.protocol)) return;
  document.querySelectorAll('[data-creator-link]').forEach(link => { link.href = url.href; });
}).catch(() => {});
document.querySelectorAll('.main-nav a').forEach(link => {
  if (new URL(link.href).pathname === location.pathname && !new URL(link.href).hash) link.setAttribute('aria-current', 'page');
});

let returnFocus;
document.querySelectorAll('[data-dialog]').forEach(button => button.addEventListener('click', () => {
  const dialog = document.getElementById(button.dataset.dialog);
  returnFocus = button;
  dialog.showModal();
  document.body.classList.add('dialog-open');
}));
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', event => { if (event.target === dialog) {
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  }});
  dialog.addEventListener('close', () => { document.body.classList.remove('dialog-open'); returnFocus?.focus(); });
});
const cards = document.querySelector('.feature-carousel');
if (cards) {
  const previous = document.getElementById('cards-prev');
  const next = document.getElementById('cards-next');
  const update = () => {
    previous.disabled = cards.scrollLeft < 5;
    next.disabled = cards.scrollLeft + cards.clientWidth >= cards.scrollWidth - 5;
    document.querySelector('.carousel-controls').classList.toggle('has-overflow', cards.scrollWidth > cards.clientWidth + 5);
  };
  previous.addEventListener('click', () => cards.scrollBy({left: -(cards.firstElementChild.offsetWidth + 24), behavior:'smooth'}));
  next.addEventListener('click', () => cards.scrollBy({left: cards.firstElementChild.offsetWidth + 24, behavior:'smooth'}));
  cards.addEventListener('scroll', update, {passive:true});
  new ResizeObserver(update).observe(cards);
  update();
}
