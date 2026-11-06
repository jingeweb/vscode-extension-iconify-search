import { onMount, ref, watch } from 'jinge';

import type { Icon, IconCategory } from '../common';

import { getIconCode } from './code';
import { Button } from './components/Button';
import { Popover } from './components/Popover';
import { notify } from './components/Toast';
import { t } from './locale';
import { globalStore, updateFavorIcon } from './store';
import { copyToClipboard } from './util';
import { vscode } from './vscode';

function categoryName(groups: Map<string, IconCategory>, category: string) {
  return groups.get(category)?.name ?? category;
}

function IconDetails(props: { icon: Icon }) {
  function selectCategory() {
    globalStore.groupTab = props.icon.category;
    globalStore.topTab = 'all';
  }
  return (
    <div>
      <div className='icon-details-title'>
        <strong>{props.icon.name}</strong>
        <Button
          quiet
          small
          label={
            globalStore.favorIcons.includes(props.icon.id)
              ? t('Remove favorite')
              : t('Add favorite')
          }
          className='favorite-toggle'
          on:click={() =>
            updateFavorIcon(
              globalStore.favorIcons.includes(props.icon.id) ? 'rm' : 'add',
              props.icon,
            )
          }
        >
          <span
            className={
              globalStore.favorIcons.includes(props.icon.id)
                ? 'icon-[codicon--star-full]'
                : 'icon-[codicon--star-empty]'
            }
          />
        </Button>
      </div>
      <div className='icon-details-line'>
        {t('Prefix:')}{' '}
        <button type='button' className='ui-link' on:click={selectCategory}>
          {props.icon.category}
        </button>
      </div>
      <div className='icon-details-line'>
        {t('Category:')}{' '}
        <button type='button' className='ui-link' on:click={selectCategory}>
          {categoryName(globalStore.all, props.icon.category)}
        </button>
      </div>
    </div>
  );
}
export function IcImg(props: { icon: Icon }) {
  const element = ref<HTMLSpanElement>();
  function render() {
    if (element.value) element.value.innerHTML = props.icon.body;
  }
  onMount(render);
  watch(props, 'icon', render);
  return <span ref={element} className='icon-image' aria-hidden='true' />;
}
export function Ic(props: { icon: Icon }) {
  async function copy() {
    try {
      await copyToClipboard(getIconCode(props.icon, globalStore.codeType));
      notify(t('Copied!'));
    } catch {
      notify(t('Could not copy icon'), true);
    }
  }
  return (
    <Popover slot:content={<IconDetails icon={props.icon} />}>
      <div className='icon-card'>
        <button
          type='button'
          className='icon-copy'
          aria-label={`${t('Copy icon')}: ${props.icon.name}`}
          on:click={() => {
            void copy();
          }}
        >
          <IcImg icon={props.icon} />
          <span className='icon-name'>{props.icon.name}</span>
        </button>
        <div className='icon-controls'>
          <Button
            small
            primary
            label={t('Copy icon')}
            on:click={() => {
              void copy();
            }}
          >
            <span className='icon-[codicon--copy]' />
          </Button>
          <Button
            small
            primary
            label={t('Insert icon')}
            on:click={() =>
              vscode.postMessage({
                type: 'insert',
                code: getIconCode(props.icon, globalStore.codeType),
              })
            }
          >
            <span className='icon-[codicon--code]' />
          </Button>
        </div>
      </div>
    </Popover>
  );
}
