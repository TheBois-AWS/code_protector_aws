import { openModal, closeModal } from './modal.js';

export function createConfirmController({
  modal,
  title,
  message,
  confirmButton,
  cancelButton
} = {}) {
  const modalEl = typeof modal === 'string' ? document.getElementById(modal) : modal;
  const titleEl = typeof title === 'string' ? document.getElementById(title) : title;
  const messageEl = typeof message === 'string' ? document.getElementById(message) : message;
  const confirmEl = typeof confirmButton === 'string' ? document.getElementById(confirmButton) : confirmButton;
  const cancelEl = typeof cancelButton === 'string' ? document.getElementById(cancelButton) : cancelButton;

  if (!modalEl || !confirmEl || !cancelEl) {
    return {
      ask: async () => false
    };
  }

  return {
    ask({ titleText = 'Confirm', messageText = 'Are you sure?' } = {}) {
      if (titleEl) titleEl.textContent = titleText;
      if (messageEl) messageEl.textContent = messageText;

      return new Promise((resolve) => {
        const cleanup = () => {
          confirmEl.removeEventListener('click', onConfirm);
          cancelEl.removeEventListener('click', onCancel);
        };

        const onConfirm = () => {
          cleanup();
          closeModal(modalEl);
          resolve(true);
        };

        const onCancel = () => {
          cleanup();
          closeModal(modalEl);
          resolve(false);
        };

        confirmEl.addEventListener('click', onConfirm);
        cancelEl.addEventListener('click', onCancel);
        openModal(modalEl);
      });
    }
  };
}
