import { vm, watch } from 'jinge';

import { Button } from '../components/Button';
import { Tabs, type TabOption } from '../components/Tabs';
import { t } from '../locale';
import { createIconResults } from '../results';
import { GROUP_ALL_KEY, globalStore } from '../store';
import { Gallery } from './Gallery';
import { Search } from './Search';

export function IconsView() {
  const results = createIconResults();
  const resultState = results.state;
  const state = vm({ tabs: [] as TabOption[] });
  function updateTabs() {
    state.tabs = [
      { label: t('ALL'), value: GROUP_ALL_KEY },
      ...[...new Set([...globalStore.favorTabs, ...globalStore.all.keys()])]
        .filter((key) => globalStore.all.has(key))
        .map((key) => ({ label: globalStore.all.get(key)!.name, value: key })),
    ];
  }
  watch(globalStore, 'all', updateTabs, { immediate: true });
  watch(globalStore, 'favorTabs', updateTabs, { deep: true });
  return (
    <>
      <Search
        value={globalStore.searchText}
        on:search={(value) => {
          globalStore.searchText = value;
        }}
      />
      <Tabs
        options={state.tabs}
        value={globalStore.groupTab}
        label={t('Category:')}
        on:change={(value) => {
          globalStore.groupTab = value;
        }}
      />
      {resultState.error && resultState.count > 0 && (
        <button type='button' on:click={() => results.retry()}>
          {t('Retry')}
        </button>
      )}
      {resultState.count > 0 ? (
        <Gallery
          count={resultState.count}
          revision={resultState.revision}
          resetKey={resultState.resetKey}
          getIcon={results.getIcon}
          on:range={results.range}
        />
      ) : (
        <div className='ui-empty'>
          {resultState.loading ? (
            <span className='ui-spinner' />
          ) : resultState.error ? (
            <button type='button' on:click={() => results.retry()}>
              {t('Could not load icons. Please try again.')} {t('Retry')}
            </button>
          ) : globalStore.groupTab === GROUP_ALL_KEY ? (
            t('No Icons')
          ) : (
            <Button
              quiet
              on:click={() => {
                globalStore.groupTab = GROUP_ALL_KEY;
              }}
            >
              {t('No icons yet, click to view all icons')}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
