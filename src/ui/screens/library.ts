import { goStart, navigate } from '../../app/actions';
import { gameCache, type LibrarySummary } from '../../store/cache';
import { button, downloadBlob, h } from '../dom';
import { badge, emptyState, screenHead, section } from '../components';

/**
 * 生成列表：正式关结算时把 Lux3D GLB 从关卡缓存归档到这里。
 * 关卡缓存会被清理，归档保留；用户可以重新下载，也可以显式删除归档释放空间。
 */
export function renderLibrary(): HTMLElement {
  const list = h(
    'div',
    { class: 'library-list' },
    h('p', { class: 'hint', text: '正在读取本地归档…' }),
  );
  const summary = h('p', { class: 'library-summary', text: '本地归档：读取中…' });
  const feedback = h('p', { class: 'hint', attrs: { 'aria-live': 'polite' } });
  let records: LibrarySummary[] = [];

  const sizeText = (bytes: number): string =>
    bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(bytes / 1024)}KB`;

  const safeName = (value: string): string =>
    value
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'treasure';

  const refresh = async (): Promise<void> => {
    try {
      records = await gameCache.listLibrary();
    } catch {
      records = [];
    }
    const total = records.reduce((sum, record) => sum + record.size, 0);
    summary.textContent = records.length
      ? `本地归档：${records.length} 件 · ${sizeText(total)} · 可随时重新下载`
      : '本地归档：还没有生成过可下载的 Lux3D 珍宝';
    if (records.length === 0) {
      list.replaceChildren(
        emptyState('正式关卡结算后，5 件 Lux3D 生成模型会归档到这里。'),
        h('p', {
          class: 'hint',
          text: '教学 / 演示关使用内置预置模型，不进入生成列表；正式关模型才会归档。',
        }),
      );
      return;
    }
    list.replaceChildren(
      ...records.map((record) =>
        h(
          'article',
          { class: 'library-row' },
          h(
            'div',
            { class: 'library-row__head' },
            h('h3', { class: 'library-row__name', text: record.name }),
            badge(record.authentic ? '真品' : '仿品', record.authentic ? 'teal' : 'muted'),
          ),
          h('p', { class: 'library-row__meta' }, `创作人：${record.creator} · ${record.worldName}`),
          h(
            'p',
            { class: 'library-row__meta library-row__meta--sub' },
            `${new Date(record.savedAt).toLocaleString('zh-CN')} · ${sizeText(record.size)}`,
          ),
          h(
            'div',
            { class: 'actions-row' },
            button('下载 GLB', {
              variant: 'primary',
              onClick: () => {
                void gameCache.getLibraryModel(record.key).then((blob) => {
                  if (!blob) {
                    feedback.textContent = '归档已失效，请重新生成本关模型。';
                    return;
                  }
                  downloadBlob(blob, `${safeName(record.worldName)}-${safeName(record.name)}.glb`);
                  feedback.textContent = `已开始下载：${record.name}.glb`;
                });
              },
            }),
            button('删除归档', {
              variant: 'subtle',
              onClick: () => {
                if (!window.confirm(`删除「${record.name}」的本地归档？删除后无法找回。`)) return;
                void gameCache.deleteLibraryModel(record.key).then(refresh);
              },
            }),
          ),
        ),
      ),
    );
  };

  const clear = (): void => {
    if (records.length === 0) return;
    if (
      !window.confirm(
        '清空全部本地归档？删除后无法找回；Lux3D 产物 URL 仅 2 小时有效，重新生成会再次消耗积分。',
      )
    ) {
      return;
    }
    void gameCache.clearLibrary().then(refresh);
  };

  void refresh();

  return h(
    'div',
    { class: 'screen-body library-screen' },
    screenHead(
      '生成列表',
      '正式关的 Lux3D 珍宝模型归档。关卡缓存结算后自动清理，这里保留可下载原件。',
      [
        button('← 开始页', { variant: 'subtle', onClick: () => goStart() }),
        button('去穿越', {
          variant: 'subtle',
          onClick: () => navigate('travel'),
        }),
      ],
    ),
    section(
      '本地模型归档',
      summary,
      h('p', {
        class: 'hint',
        text: '清空归档会释放浏览器空间，但文件无法找回；建议先逐件下载。',
      }),
      h(
        'div',
        { class: 'actions-row' },
        button('清空全部归档', { variant: 'danger', onClick: clear }),
      ),
      feedback,
      list,
    ),
  );
}
