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
  const listId = `select-${uid()}`;
  const state = vm({ open: false, query: '', active: 0, filtered: [] as SelectOption[] });
  const filter = () => {
    state.filtered = props.options.filter((option) =>
      option.label.toLowerCase().includes(state.query.toLowerCase()),
    );
    state.active = 0;
  };
  watch(state, 'query', filter);
  watch(props, 'options', filter, { immediate: true });
  function choose(value: string) {
    const selected = new Set(props.value);
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
    filter();
  }
  function display(values: string[], options: SelectOption[]) {
    return values
      .map((value) => options.find((option) => option.value === value)?.label ?? value)
      .join(', ');
  }
  onMount(() => {
    const outside = (event: PointerEvent) => {
      if (!element.value?.contains(event.target as Node)) state.open = false;
    };
    const blur = (event: FocusEvent) => {
      if (!element.value?.contains(event.relatedTarget as Node)) state.open = false;
    };
    const root = element.value!;
    root.addEventListener('focusout', blur);
    document.addEventListener('pointerdown', outside);
    return () => {
      root.removeEventListener('focusout', blur);
      document.removeEventListener('pointerdown', outside);
    };
  });
  return (
    <div ref={element} className='ui-select'>
      <div className='ui-select-control'>
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
          value={state.open && props.searchable ? state.query : display(props.value, props.options)}
          placeholder={props.placeholder}
          title={display(props.value, props.options)}
          on:focus={open}
          on:click={() => {
            if (!state.open) open();
          }}
          on:input={(event) => {
            state.query = event.target.value;
            state.open = true;
          }}
          on:keyDown={(event) => {
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
        {props.clearable && !!props.value.length && (
          <button
            type='button'
            className='ui-select-clear'
            aria-label={t('Clear selection')}
            on:click={() => {
              props['on:change']([]);
              state.query = '';
            }}
          >
            ×
          </button>
        )}
        <span className='ui-select-arrow' aria-hidden='true'>
          ⌄
        </span>
      </div>
      {state.open && (
        <div
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
