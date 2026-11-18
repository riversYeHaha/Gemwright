import type { AppState, ScreenName } from './store';
import { store } from './store';
import { disposeInspectViewer, renderInspect } from '../ui/screens/inspect';
import { renderBase } from '../ui/screens/base';
import { renderGuide } from '../ui/screens/guide';
import { renderMarket } from '../ui/screens/market';
import { renderNewGame } from '../ui/screens/newgame';
import { renderSettings } from '../ui/screens/settings';
import { renderLibrary } from '../ui/screens/library';
import { renderStart } from '../ui/screens/start';
import { renderTravel } from '../ui/screens/travel';
import { disposeStartBackdrop } from '../render/startBackdrop';
import { updateFairyCompanion } from '../ui/fairyCompanion';
import { updateFairyChat } from '../ui/fairyChat';
import { renderModelLoading } from '../ui/modelLoading';
import { topbar } from '../ui/components';
import { h } from '../ui/dom';

const renderers: Record<ScreenName, (state: AppState) => HTMLElement> = {
  start: renderStart,
  newgame: renderNewGame,
  guide: renderGuide,
  settings: renderSettings,
  library: renderLibrary,
  travel: renderTravel,
  market: renderMarket,
  inspect: renderInspect,
  base: renderBase,
};

/** 极简状态路由：store 变化即重绘当前屏；离开验货 / 开始页先释放重资源。 */
export function initApp(root: HTMLElement): void {
  const render = (): void => {
    const state = store.get();
    disposeInspectViewer();
    disposeStartBackdrop();
    const screen = renderers[state.screen](state);
    const isLanding = state.screen === 'start';
    const app = h(
      'div',
      { class: `app${isLanding ? ' app--landing' : ''}` },
      isLanding ? null : topbar(state),
      h('main', { class: 'screen' }, screen),
      h('div', { class: 'toast-host', attrs: { 'aria-live': 'polite' } }),
    );
    const modelLoading = renderModelLoading(state);
    root.replaceChildren(app, ...(modelLoading ? [modelLoading] : []));
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    // 右下角精灵是固定层：由单例持有，不随整屏 replaceChildren 重建。
    updateFairyCompanion(state);
    updateFairyChat(state);
  };

  store.subscribe(render);
  render();
}
