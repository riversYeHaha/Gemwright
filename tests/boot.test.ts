import { afterEach, describe, expect, it } from 'vitest';
import { disposeStartBackdrop } from '../src/render/startBackdrop';

/**
 * 启动冒烟：真正执行 src/main.ts（读设置 / 续玩快照 → 挂载 router → 渲染首屏），
 * 用来兜住"模块循环依赖 / 首屏白屏"这类只有集成才暴露的问题。
 */

afterEach(() => {
  disposeStartBackdrop();
});

describe('应用启动', () => {
  it('首屏是开始页：标题、四个主菜单与隐私脚注都在', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    await import('../src/main');
    const app = document.querySelector('#app');
    expect(app).not.toBeNull();
    expect(app?.querySelector('.start')).not.toBeNull();
    expect(app?.querySelector('.start__canvas')).not.toBeNull();
    expect(app?.textContent).toContain('珍宝猎人');
    expect(app?.textContent).toContain('新游戏');
    expect(app?.textContent).toContain('继续游戏');
    expect(app?.textContent).toContain('游戏说明');
    expect(app?.textContent).toContain('Key 只存本机浏览器');
  });
});
