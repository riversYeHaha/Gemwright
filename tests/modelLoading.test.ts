import { describe, expect, it } from 'vitest';
import { bootstrapState } from '../src/app/actions';
import { renderModelLoading } from '../src/ui/modelLoading';

function busyState(): Parameters<typeof renderModelLoading>[0] {
  return {
    ...bootstrapState(),
    busy: {
      kind: 'models',
      message: '集市布展中：5 件珍宝并行生成',
      ratio: 0.4,
      slots: [
        { itemId: 'T1', name: '星穹之核', status: 'done' },
        { itemId: 'T2', name: '碎星残核', status: 'running' },
        { itemId: 'T3', name: '潮汐之瞳', status: 'failed', message: '占位' },
      ],
      logs: ['[1/3] 星穹之核：已就位'],
    },
  };
}

describe('全屏布展加载', () => {
  it('显示进度、零件状态与说明', () => {
    const el = renderModelLoading(busyState());
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('正在加载 3D 珍宝');
    expect(el?.textContent).toContain('2 / 3 件');
    expect(el?.textContent).toContain('40%');
    expect(el?.textContent).toContain('星穹之核');
    expect(el?.textContent).toContain('已就位');
    expect(el?.textContent).toContain('全部模型就位后自动进入世界');
    expect(el?.querySelector<HTMLElement>('.model-loading__bar-fill')?.style.width).toBe('40%');
  });

  it('不是布展状态时不渲染', () => {
    expect(renderModelLoading(bootstrapState())).toBeNull();
    expect(
      renderModelLoading({
        ...bootstrapState(),
        busy: { ...busyState().busy!, kind: 'travel' },
      }),
    ).toBeNull();
  });
});
