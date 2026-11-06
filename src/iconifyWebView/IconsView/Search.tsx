import { onUnmount, vm, watch } from 'jinge';

import { Button } from '../components/Button';
import { t } from '../locale';

export function Search(props: { value: string; 'on:search': (value: string) => void }) {
  const state = vm({ text: props.value, composing: false });
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(props, 'value', (value) => {
    clearTimeout(timer);
    state.text = value;
  });
  const submit = () => {
    clearTimeout(timer);
    props['on:search'](state.text);
  };
  function schedule() {
    clearTimeout(timer);
    if (!state.composing) timer = setTimeout(submit, 600);
  }
  onUnmount(() => clearTimeout(timer));
  return (
    <form
      className='icon-search'
      role='search'
      on:submit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className='search-input'>
        <input
          type='text'
          value={state.text}
          placeholder={t('Search Icons')}
          aria-label={t('Search Icons')}
          on:input={(event) => {
            state.text = event.target.value;
            schedule();
          }}
          on:compositionStart={() => {
            state.composing = true;
            clearTimeout(timer);
          }}
          on:compositionEnd={() => {
            state.composing = false;
            schedule();
          }}
          on:keyDown={(event) => {
            if (event.key === 'Enter' && (event.isComposing || state.composing))
              event.preventDefault();
          }}
        />
        {state.text && (
          <button
            type='button'
            aria-label={t('Clear search')}
            className='search-clear'
            on:click={() => {
              state.text = '';
              submit();
            }}
          >
            <span className='icon-[codicon--close]' />
          </button>
        )}
      </div>
      <Button primary htmlType='submit' label={t('Search Icons')}>
        <span className='icon-[codicon--search]' />
      </Button>
    </form>
  );
}
