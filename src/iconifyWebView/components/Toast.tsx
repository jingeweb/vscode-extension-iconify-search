import { vm } from 'jinge';

const state = vm({ text: '', error: false });
let timer: ReturnType<typeof setTimeout> | undefined;
export function notify(text: string, error = false) {
  clearTimeout(timer);
  state.text = text;
  state.error = error;
  timer = setTimeout(() => {
    state.text = '';
  }, 2200);
}
export function Toast() {
  return (
    <div className='ui-toast-region' aria-live='polite' aria-atomic='true'>
      {state.text && (
        <div className={state.error ? 'ui-toast error' : 'ui-toast'} role='status'>
          {state.text}
        </div>
      )}
    </div>
  );
}
if (import.meta.hot) import.meta.hot.dispose(() => clearTimeout(timer));
