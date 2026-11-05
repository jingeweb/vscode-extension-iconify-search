import { onMount, vm } from 'jinge';

import { Button } from './components/Button';
import { Tabs } from './components/Tabs';
import { Toast } from './components/Toast';
import { FavoritesView } from './FavoritesView';
import { IconsView } from './IconsView';
import { t } from './locale';
import { SettingsContent } from './Settings';
import { globalStore, requestIcons } from './store';

export function App() {
  const state = vm({ settingsOpen: false });
  onMount(requestIcons);
  return (
    <main className='iconify-app'>
      <Toast />
      {state.settingsOpen && (
        <SettingsContent
          on:close={() => {
            state.settingsOpen = false;
          }}
        />
      )}
      {globalStore.loading ? (
        <div className='ui-loading' role='status' aria-label={t('Loading icons')}>
          <span className='ui-spinner' />
        </div>
      ) : (
        <>
          <header className='app-toolbar'>
            <Tabs
              segmented
              value={globalStore.topTab}
              label={t('Iconify Icons')}
              options={[
                { label: t('ALL ICONS'), value: 'all' },
                { label: t('MY FAVORITES'), value: 'favor' },
              ]}
              on:change={(value) => {
                globalStore.topTab = value as 'all' | 'favor';
              }}
            />
            <Button
              small
              quiet
              label={t('Settings')}
              on:click={() => {
                state.settingsOpen = true;
              }}
            >
              <span className='icon-[ant-design--setting-outlined]' />
            </Button>
          </header>
          {globalStore.topTab === 'all' ? <IconsView /> : <FavoritesView />}
        </>
      )}
    </main>
  );
}
