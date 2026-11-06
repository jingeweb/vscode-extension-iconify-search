import { vm, watch } from 'jinge';

import type { IconCodeType } from '../common';

import { Button } from './components/Button';
import { Modal } from './components/Modal';
import { Select, type SelectOption } from './components/Select';
import { t } from './locale';
import { globalStore, saveSettings } from './store';

const codeTypes: SelectOption[] = [
  { label: 'Icon Name', value: 'name' },
  { label: 'SVG', value: 'svg' },
  { label: 'React', value: 'react' },
  { label: 'Vue', value: 'vue' },
  { label: 'Tailwind CSS', value: 'tailwindcss' },
  { label: 'Tailwind CSS React', value: 'tailwindcss-react' },
  { label: 'Iconify Icon', value: 'iconify-icon' },
  { label: 'Iconify React', value: 'iconify-react' },
  { label: 'Unplugin Icons', value: 'unplugin-icons' },
  { label: 'UnoCSS', value: 'unocss' },
  { label: 'UnoCSS React', value: 'unocss-react' },
];
export function SettingsContent(props: { 'on:close': () => void }) {
  const state = vm({
    codeType: globalStore.codeType || 'tailwindcss-react',
    favorTabs: [...globalStore.favorTabs],
    favorGroup: globalStore.favorGroup,
    groups: [] as SelectOption[],
  });
  watch(
    globalStore,
    'all',
    () => {
      state.groups = [...globalStore.all.values()].map((group) => ({
        label: group.name,
        value: group.category,
      }));
    },
    { immediate: true },
  );
  return (
    <Modal title={t('Settings')} on:close={props['on:close']}>
      <form
        className='settings-form'
        on:submit={(event) => {
          event.preventDefault();
          saveSettings({
            codeType: state.codeType as IconCodeType,
            favorTabs: [...state.favorTabs],
            favorGroup: state.favorGroup || '',
          });
          props['on:close']();
        }}
      >
        <div className='settings-field'>
          <label htmlFor='code-type'>{t('Type of Code')}</label>
          <Select
            id='code-type'
            options={codeTypes}
            value={[state.codeType]}
            on:change={(values) => {
              state.codeType = values[0] as IconCodeType;
            }}
          />
        </div>
        <div className='settings-field'>
          <label htmlFor='favor-tabs'>{t('Tabs Displyed First')}</label>
          <Select
            id='favor-tabs'
            options={state.groups}
            value={state.favorTabs}
            searchable
            multiple
            clearable
            on:change={(values) => {
              state.favorTabs = values;
            }}
          />
        </div>
        <div className='settings-field'>
          <label htmlFor='favor-group'>{t('Default Open Tab')}</label>
          <Select
            id='favor-group'
            options={state.groups}
            value={state.favorGroup ? [state.favorGroup] : []}
            searchable
            clearable
            placeholder={t('ALL')}
            on:change={(values) => {
              state.favorGroup = values[0] ?? '';
            }}
          />
        </div>
        <footer className='settings-actions'>
          <Button on:click={() => props['on:close']()}>{t('Cancel')}</Button>
          <Button primary htmlType='submit'>
            {t('Confirm')}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
