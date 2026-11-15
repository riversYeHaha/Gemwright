import { describe, expect, it } from 'vitest';

/**
 * 启动冒烟：真正执行 src/main.ts（读设置 → 挂载 router → 渲染首屏），
 * 用来兜住"模块循环依赖 / 首屏白屏"这类只有集成才暴露的问题。
 */
describe('应用启动', () => {
  it('无 Key 时首屏落在设置页，顶栏与表单都在', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    await import('../src/main');
    const app = document.querySelector('#app');
    expect(app).not.toBeNull();
    expect(app?.querySelector('.topbar')).not.toBeNull();
    expect(app?.textContent).toContain('设置');
    expect(app?.querySelector('input[type="password"]')).not.toBeNull();
    expect(app?.textContent).toContain('珍宝猎人');
  });
});
