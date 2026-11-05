import { For, KEY_DATA, cx, ref } from 'jinge';

export interface TabOption {
  value: string;
  label: string;
}
export function Tabs(props: {
  options: TabOption[];
  value: string;
  segmented?: boolean;
  label: string;
  'on:change': (value: string) => void;
}) {
  const element = ref<HTMLDivElement>();
  function move(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = props.options.findIndex((option) => option.value === props.value);
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? props.options.length - 1
          : (current + (event.key === 'ArrowRight' ? 1 : -1) + props.options.length) %
            props.options.length;
    const option = props.options[index];
    if (!option) return;
    props['on:change'](option.value);
    element.value?.querySelectorAll<HTMLButtonElement>('button')[index]?.focus();
  }
  return (
    <div
      ref={element}
      className={cx('ui-tabs', props.segmented && 'segmented')}
      role='tablist'
      aria-label={props.label}
      on:keyDown={move}
    >
      <For loop={props.options} key={KEY_DATA}>
        {(each) => (
          <button
            type='button'
            role='tab'
            aria-selected={props.value === each.data.value}
            tabIndex={props.value === each.data.value ? 0 : -1}
            className={cx('ui-tab', props.value === each.data.value && 'selected')}
            on:click={() => props['on:change'](each.data.value)}
          >
            {each.data.label}
          </button>
        )}
      </For>
    </div>
  );
}
