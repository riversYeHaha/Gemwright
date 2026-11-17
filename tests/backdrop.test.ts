import { afterEach, describe, expect, it } from 'vitest';
import { disposeStartBackdrop, mountStartBackdrop } from '../src/render/startBackdrop';

afterEach(() => {
  disposeStartBackdrop();
});

describe('开始页黑洞背景的生命周期', () => {
  it('挂载一块 canvas；重复挂载先释放上一个；dispose 幂等', () => {
    const first = document.createElement('div');
    const second = document.createElement('div');

    mountStartBackdrop(first);
    expect(first.querySelector('canvas')).not.toBeNull();

    mountStartBackdrop(second);
    expect(first.querySelector('canvas')).toBeNull();
    expect(second.querySelector('canvas')).not.toBeNull();

    disposeStartBackdrop();
    expect(second.querySelector('canvas')).toBeNull();
    expect(() => disposeStartBackdrop()).not.toThrow();
  });

  it('resize 只保留一块画布，不抛错', () => {
    const host = document.createElement('div');
    mountStartBackdrop(host);
    window.dispatchEvent(new Event('resize'));
    expect(host.querySelectorAll('canvas')).toHaveLength(1);
    disposeStartBackdrop();
    expect(host.querySelector('canvas')).toBeNull();
  });
});
