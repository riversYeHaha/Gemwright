import { describe, expect, it } from 'vitest';

/**
 * 启动冒烟：真正执行 src/main.ts（读设置 / 续玩快照 → 挂载 router → 渲染首屏），
 * 用来兜住"模块循环依赖 / 首屏白屏"这类只有集成才暴露的问题。
 */
describe('应用启动', () => {
  it('首屏是开始页：品牌、教学入口、正式开局入口都在', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    await import('../src/main');
    const app = document.querySelector('#app');
    expect(app).not.toBeNull();
    expect(app?.querySelector('.landing')).not.toBeNull();
    expect(app?.textContent).toContain('珍宝猎人');
    expect(app?.textContent).toContain('教学关卡');
    expect(app?.textContent).toContain('开始游戏');
    expect(app?.textContent).toContain('Key 只存本机浏览器');
  });
});
