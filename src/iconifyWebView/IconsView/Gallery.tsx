import { For, KEY_DATA, onMount, onUnmount, ref, vm, vmIgnore, watch } from 'jinge';

import type { Icon } from '../../common';

import { Ic } from '../Ic';
import { galleryLayout } from './galleryLayout';

export function Gallery(props: {
  count: number;
  revision: number;
  resetKey: number;
  getIcon: (index: number) => Icon | undefined;
  'on:range': (start: number, end: number) => void;
}) {
  const element = ref<HTMLDivElement>();
  const state = vm({
    height: 0,
    translateY: 0,
    cells: vmIgnore([] as { index: number; icon?: Icon }[]),
  });
  let frame = 0;
  let lastStart = -1,
    lastEnd = -1,
    lastRevision = -1;
  let cells = new Map<number, { index: number; icon?: Icon }>();
  function update(reset = false) {
    const container = element.value;
    if (!container) return;
    if (reset) container.scrollTop = 0;
    const layout = galleryLayout(
      props.count,
      container.clientWidth,
      container.clientHeight,
      container.scrollTop,
    );
    state.height = layout.totalHeight;
    state.translateY = layout.translateY;
    if (
      reset ||
      layout.start !== lastStart ||
      layout.end !== lastEnd ||
      props.revision !== lastRevision
    ) {
      const next = new Map<number, { index: number; icon?: Icon }>();
      state.cells = vmIgnore(
        Array.from({ length: layout.end - layout.start }, (_, offset) => {
          const index = layout.start + offset;
          const icon = props.getIcon(index);
          const previous = cells.get(index);
          const cell = previous && previous.icon === icon ? previous : vmIgnore({ index, icon });
          next.set(index, cell);
          return cell;
        }),
      );
      cells = next;
      lastStart = layout.start;
      lastEnd = layout.end;
      lastRevision = props.revision;
    }
    props['on:range'](layout.start, layout.end);
  }
  function schedule() {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
  }
  watch(props, 'count', schedule);
  watch(props, 'revision', schedule);
  watch(props, 'resetKey', () => update(true));
  onMount(() => {
    update(true);
    const observer = new ResizeObserver(schedule);
    observer.observe(element.value!);
    return () => observer.disconnect();
  });
  onUnmount(() => cancelAnimationFrame(frame));
  return (
    <div ref={element} className='icon-gallery' on:scroll={schedule}>
      <div className='gallery-spacer' style={`height:${state.height}px;`}>
        <div className='gallery-row' style={`transform:translateY(${state.translateY}px);`}>
          <For loop={state.cells} key={KEY_DATA}>
            {(each) =>
              each.data.icon ? (
                <Ic icon={each.data.icon} />
              ) : (
                <div className='icon-card' aria-busy='true' />
              )
            }
          </For>
        </div>
      </div>
    </div>
  );
}
