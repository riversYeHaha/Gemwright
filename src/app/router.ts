import type { AppState, ScreenName } from './store';
import { store } from './store';
import { disposeInspectViewer, renderInspect } from '../ui/screens/inspect';
import { renderBase } from '../ui/screens/base';
import { renderMarket } from '../ui/screens/market';
import { renderSettings } from '../ui/screens/settings';
import { renderTravel } from '../ui/screens/travel';
import { topbar } from '../ui/components';
import { h } from '../ui/dom';

const renderers: Record<ScreenName, (state: AppState) => HTMLElement> = {
  settings: renderSettings,
  travel: renderTravel,
  market: renderMarket,
  inspect: renderInspect,
  base: renderBase,
};

/** 极简状态路由：store 变化即重绘当前屏；离开验货屏先释放 WebGL 资源。 */
export function initApp(root: HTMLElement): void {
  const render = (): void => {
    const state = store.get();
    disposeInspectViewer();
    const screen = renderers[state.screen](state);
    root.replaceChildren(
      h(
        'div',
        { class: 'app' },
        topbar(state),
        h('main', { class: 'screen' }, screen),
        h('div', { class: 'toast-host', attrs: { 'aria-live': 'polite' } }),
      ),
    );
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  };

  store.subscribe(render);
  render();
}
