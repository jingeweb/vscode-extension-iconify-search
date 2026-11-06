import { For, KEY_DATA, cx, onMount, ref, uid, vm, watch } from 'jinge';

import { t } from '../locale';

export interface SelectOption {
  value: string;
  label: string;
}
export function Select(props: {
  id: string;
  options: SelectOption[];
  value: string[];
  multiple?: boolean;
  searchable?: boolean;
  clearable?: boolean;
  placeholder?: string;
  'on:change': (value: string[]) => void;
}) {
  const element = ref<HTMLDivElement>();
  const input = ref<HTMLInputElement>();
  let panel: HTMLDivElement | undefined;
  let observer: ResizeObserver | undefined;
  let frame = 0;
  const listId = `select-${uid()}`;
  const state = vm({
    open: false,
    searching: false,
    query: '',
    active: 0,
    filtered: [] as SelectOption[],
  });
  const filter = () => {
    state.filtered = props.options.filter((option) =>
      option.label.toLowerCase().includes(state.query.toLowerCase()),
    );
    state.active = 0;
  };
  watch(state, 'query', filter);
  watch(props, 'options', filter, { immediate: true });
  let restoringFocus = false;
  function remove(value: string, button: HTMLButtonElement) {
    const restoreFocus = document.activeElement === button;
    props['on:change'](props.value.filter((selected) => selected !== value));
    if (restoreFocus) {
      restoringFocus = true;
      input.value?.focus();
      restoringFocus = false;
    }
  }
  function choose(value: string) {
    const selected = new Set(props.value);
    state.query = '';
    state.searching = false;
    if (props.multiple) {
      if (selected.has(value)) selected.delete(value);
      else selected.add(value);
      props['on:change']([...selected]);
      input.value?.focus();
    } else {
      props['on:change']([value]);
      state.open = false;
    }
  }
  function open() {
    state.open = true;
    state.query = '';
    state.searching = false;
    filter();
  }
  function beginSearch(target: HTMLInputElement) {
    if (!props.searchable || state.searching) return;
    // Selected labels are display text, not part of the next search or IME composition.
    target.value = '';
    state.query = '';
    state.searching = true;
  }
  function display(values: string[], options: SelectOption[]) {
    return values
      .map((value) => options.find((option) => option.value === value)?.label ?? value)
      .join(', ');
  }
  function position() {
    if (!state.open || !element.value?.isConnected || !panel?.isConnected) return;
    const rect = element.value.getBoundingClientRect();
    const gap = 4;
    const edge = 8;
    const below = Math.max(0, window.innerHeight - rect.bottom - gap - edge);
    const above = Math.max(0, rect.top - gap - edge);
    const width = Math.max(0, Math.min(rect.width, window.innerWidth - edge * 2));
    panel.style.width = `${width}px`;
    panel.style.maxHeight = '180px';
    const down = below >= panel.offsetHeight || below >= above;
    panel.style.maxHeight = `${Math.min(180, down ? below : above)}px`;
    panel.style.left = `${Math.max(edge, Math.min(rect.left, window.innerWidth - width - edge))}px`;
    panel.style.top = `${down ? rect.bottom + gap : Math.max(edge, rect.top - gap - panel.offsetHeight)}px`;
    panel.style.visibility = 'visible';
  }
  function schedulePosition() {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        position();
      });
  }
  onMount(() => {
    const outside = (event: PointerEvent) => {
      if (!element.value?.contains(event.target as Node)) state.open = false;
    };
    const blur = (event: FocusEvent) => {
      if (!element.value?.contains(event.relatedTarget as Node)) state.open = false;
    };
    const root = element.value!;
    observer = new ResizeObserver(schedulePosition);
    observer.observe(root);
    if (panel) observer.observe(panel);
    const scroll = (event: Event) => {
      if (!panel?.contains(event.target as Node)) schedulePosition();
    };
    root.addEventListener('focusout', blur);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', schedulePosition);
    window.addEventListener('scroll', scroll, true);
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
      root.removeEventListener('focusout', blur);
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', schedulePosition);
      window.removeEventListener('scroll', scroll, true);
    };
  });
  return (
    <div ref={element} className='ui-select'>
      <div className='ui-select-control'>
        <div className={cx('ui-select-values', props.multiple && 'multiple')}>
          {props.multiple && (
            <For loop={props.value} key={KEY_DATA}>
              {(each) => (
                <span className='ui-select-tag'>
                  <span className='ui-select-tag-label' title={display([each.data], props.options)}>
                    {display([each.data], props.options)}
                  </span>
                  <button
                    type='button'
                    className='ui-select-tag-remove'
                    aria-label={`${t('Remove selection')}: ${display([each.data], props.options)}`}
                    title={t('Remove selection')}
                    on:mouseDown={(event) => event.preventDefault()}
                    on:click={(event) =>
                      remove(each.data, event.currentTarget as HTMLButtonElement)
                    }
                  >
                    <span className='icon-[codicon--close]' aria-hidden='true' />
                  </button>
                </span>
              )}
            </For>
          )}
          <input
            ref={input}
            id={props.id}
            role='combobox'
            aria-expanded={state.open}
            aria-controls={listId}
            aria-autocomplete={props.searchable ? 'list' : 'none'}
            aria-activedescendant={
              state.open && state.filtered.length ? `${listId}-${state.active}` : undefined
            }
            autoComplete='off'
            readOnly={!props.searchable}
            value={
              props.multiple
                ? state.open
                  ? state.query
                  : ''
                : state.open && state.searching && props.searchable
                  ? state.query
                  : display(props.value, props.options)
            }
            placeholder={props.multiple && props.value.length ? undefined : props.placeholder}
            title={display(props.value, props.options)}
            on:focus={() => {
              if (!restoringFocus) open();
            }}
            on:click={() => {
              if (!state.open) open();
            }}
            on:beforeInput={(event) => beginSearch(event.target)}
            on:compositionStart={(event) => beginSearch(event.target)}
            on:input={(event) => {
              state.query = event.target.value;
              state.searching = true;
              state.open = true;
            }}
            on:keyDown={(event) => {
              if (event.isComposing) return;
              if (event.key === 'Escape' && state.open) {
                event.preventDefault();
                event.stopPropagation();
                state.open = false;
              } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (!state.open) open();
                else
                  state.active = Math.max(
                    0,
                    Math.min(
                      state.filtered.length - 1,
                      state.active + (event.key === 'ArrowDown' ? 1 : -1),
                    ),
                  );
                element.value
                  ?.querySelector(`#${listId}-${state.active}`)
                  ?.scrollIntoView({ block: 'nearest' });
              } else if (event.key === 'Enter' && state.open) {
                event.preventDefault();
                const option = state.filtered[state.active];
                if (option) choose(option.value);
              }
            }}
          />
        </div>
        {props.clearable && !!props.value.length && (
          <button
            type='button'
            className='ui-select-clear'
            aria-label={t('Clear selection')}
            on:click={() => {
              props['on:change']([]);
              state.query = '';
              state.searching = false;
            }}
          >
            <span className='icon-[codicon--close]' />
          </button>
        )}
        <span className='ui-select-arrow' aria-hidden='true'>
          <span className='icon-[codicon--chevron-down]' />
        </span>
      </div>
      {state.open && (
        <div
          ref={(value: HTMLDivElement | undefined) => {
            if (panel) observer?.unobserve(panel);
            panel = value;
            if (value) {
              value.style.visibility = 'hidden';
              observer?.observe(value);
              queueMicrotask(position);
            }
          }}
          id={listId}
          role='listbox'
          aria-multiselectable={props.multiple || undefined}
          className='ui-select-options'
        >
          <For loop={state.filtered} key={KEY_DATA}>
            {(each) => (
              <button
                type='button'
                id={`${listId}-${each.index}`}
                role='option'
                aria-selected={props.value.includes(each.data.value)}
                tabIndex={-1}
                className={cx(
                  'ui-select-option',
                  state.active === each.index && 'active',
                  props.value.includes(each.data.value) && 'selected',
                )}
                on:mouseDown={(event) => event.preventDefault()}
                on:click={() => choose(each.data.value)}
              >
                {props.multiple && (
                  <span aria-hidden='true'>
                    {props.value.includes(each.data.value) ? '✓' : ' '}
                  </span>
                )}
                {each.data.label}
              </button>
            )}
          </For>
          {!state.filtered.length && <div className='ui-empty'>{t('No results')}</div>}
        </div>
      )}
    </div>
  );
}
