export function openModal(target) {
  const modal = typeof target === 'string' ? document.getElementById(target) : target;
  if (!modal) return;
  modal.style.display = 'flex';
}

export function closeModal(target) {
  const modal = typeof target === 'string' ? document.getElementById(target) : target;
  if (!modal) return;
  modal.style.display = 'none';
}

export function bindBackdropClose(modal, { lockAttr = 'data-lock-backdrop' } = {}) {
  const node = typeof modal === 'string' ? document.getElementById(modal) : modal;
  if (!node) return () => {};

  const onClick = (event) => {
    if (event.target !== node) return;
    if (node.getAttribute(lockAttr) === 'true') return;
    closeModal(node);
  };

  node.addEventListener('click', onClick);
  return () => node.removeEventListener('click', onClick);
}
