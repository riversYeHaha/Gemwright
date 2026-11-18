import { initApp } from './app/router';
import { bootstrapState } from './app/actions';
import { store } from './app/store';
import * as actions from './app/actions';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/screens.css';
import './styles/start.css';
import './styles/fairy.css';
import './styles/modelLoading.css';

/**
 * 入口：读本机设置 / 存档 → 挂载 8 屏应用。
 * 纯静态站，无后端；Key 只在浏览器里。
 */
function boot(): void {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) throw new Error('缺少 #app 挂载点');

  store.set(bootstrapState());
  initApp(root);
  if (store.get().resumeAvailable) actions.hydrateActiveModels();

  window.addEventListener('error', (event) => {
    console.error('[gemwright] 未捕获异常', event.error ?? event.message);
  });

  if (import.meta.env.DEV) {
    (window as unknown as { gemwright: unknown }).gemwright = { store, actions };
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
