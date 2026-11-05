import { Gallery } from '../IconsView/Gallery';
import { t } from '../locale';
import { createIconResults } from '../results';

export function FavoritesView() {
  const results = createIconResults(true);
  const resultState = results.state;
  return (
    <>
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
          ) : (
            t('No Icons')
          )}
        </div>
      )}
    </>
  );
}
