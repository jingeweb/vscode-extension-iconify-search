import { onMount, onUnmount, ref, uid, type JNode, type WithChildren } from 'jinge';

import { t } from '../locale';
import { Button } from './Button';

export function Modal(props: WithChildren<JNode> & { title: string; 'on:close': () => void }) {
  const element = ref<HTMLDialogElement>();
  const titleId = `modal-${uid()}`;
  let previousFocus: HTMLElement | null = null;
  onMount(() => {
    previousFocus = document.activeElement as HTMLElement | null;
    const dialog = element.value!;
    const cancel = (event: Event) => {
      event.preventDefault();
      props['on:close']();
    };
    dialog.addEventListener('cancel', cancel);
    dialog.showModal();
    return () => dialog.removeEventListener('cancel', cancel);
  });
  onUnmount(() => {
    element.value?.close();
    previousFocus?.focus();
  });
  return (
    <dialog
      ref={element}
      className='ui-modal'
      aria-labelledby={titleId}
      on:click={(event) => {
        const rect = element.value!.getBoundingClientRect();
        if (
          event.target === element.value &&
          (event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom)
        )
          props['on:close']();
      }}
    >
      <div className='ui-modal-header'>
        <h2 id={titleId}>{props.title}</h2>
        <Button quiet small label={t('Cancel')} on:click={() => props['on:close']()}>
          <span aria-hidden='true'>×</span>
        </Button>
      </div>
      {props.children}
    </dialog>
  );
}
