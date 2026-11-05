import {
  Portal,
  onMount,
  onUnmount,
  ref,
  vm,
  type JNode,
  type WithChildren,
  type WithSlots,
} from 'jinge';

export function Popover(props: WithChildren<JNode> & WithSlots<{ content: JNode }>) {
  const anchor = ref<HTMLDivElement>();
  const state = vm({ open: false, style: 'visibility:hidden' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let panel: HTMLDivElement | undefined;
  function position() {
    if (!anchor.value || !panel) return;
    const rect = anchor.value.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const left = Math.max(
      8,
      Math.min(window.innerWidth - width - 8, rect.left + (rect.width - width) / 2),
    );
    const top =
      rect.top >= height + 12
        ? rect.top - height - 8
        : Math.min(window.innerHeight - height - 8, rect.bottom + 8);
    state.style = `left:${left}px;top:${Math.max(8, top)}px;`;
  }
  function keep() {
    clearTimeout(timer);
  }
  function show(immediate = false) {
    keep();
    if (state.open) {
      position();
      return;
    }
    timer = setTimeout(
      () => {
        state.style = 'visibility:hidden';
        state.open = true;
      },
      immediate ? 0 : 400,
    );
  }
  function hide() {
    keep();
    state.open = false;
  }
  function leave() {
    keep();
    timer = setTimeout(hide, 180);
  }
  onMount(() => {
    const outside = (event: PointerEvent) => {
      if (!anchor.value?.contains(event.target as Node) && !panel?.contains(event.target as Node))
        hide();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', hide, true);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('resize', hide);
      window.removeEventListener('scroll', hide, true);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  });
  onUnmount(keep);
  return (
    <div
      ref={anchor}
      className='ui-popover-anchor'
      on:mouseEnter={() => show()}
      on:mouseLeave={leave}
      on:focusCapture={() => show(true)}
      on:click={hide}
    >
      {props.children}
      {state.open && (
        <Portal>
          <div
            ref={(element: HTMLDivElement | undefined) => {
              panel = element;
              if (element) queueMicrotask(position);
            }}
            className='ui-popover'
            role='dialog'
            aria-label='Icon details'
            style={state.style}
            on:mouseEnter={keep}
            on:mouseLeave={leave}
            on:focusCapture={keep}
          >
            {props['slot:content']}
          </div>
        </Portal>
      )}
    </div>
  );
}
