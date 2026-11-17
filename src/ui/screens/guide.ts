import { navigate, startTutorial } from '../../app/actions';
import { button, h } from '../dom';
import { badge, screenHead, section } from '../components';

/**
 * 游戏说明：把"怎么玩、怎么判、额度怎么算"集中在一页，
 * 开始页因此只需要承担门面与导航。
 */
export function renderGuide(): HTMLElement {
  return h(
    'div',
    { class: 'screen-body' },
    screenHead('游戏说明', '一局 5 件珍宝：砍价买下、亲手验货、回基地揭晓真伪。', [
      badge('本地数值判定', 'gold'),
      badge('零后端', 'teal'),
    ]),
    section(
      '一局怎么走',
      h(
        'ol',
        { class: 'guide-steps' },
        step(
          '01',
          '穿越',
          '抽一个世界种子，LLM 生成世界、创作人规范与 5 件珍宝；3D 模型在后台并行布展。',
        ),
        step('02', '开市', '看标价、署名与摊主的一句话，逐件进 3D 验货，再用精灵情报交叉比对。'),
        step('03', '砍价', '报价，看摊主反应。议价额度有限，买不完也很正常——这才是取舍。'),
        step('04', '鉴宝', '收摊回基地，逐件揭晓真伪与特征差异，决定回收还是放弃。'),
        step('05', '结算', '净收益转化为经验与等级；出价额度、询问额度与下一关难度一起提升。'),
      ),
    ),
    section(
      '怎么判断真伪',
      h('p', {
        class: 'guide-lead',
        text: '每件珍宝有四项特征。把它们和「创作人真品规范」逐项对照——四项全对才是真品。',
      }),
      h(
        'div',
        { class: 'guide-traits' },
        trait('色族', '青蓝、赤金、墨黑、霜白、紫晶、苔绿…'),
        trait('颗数', '数清星砂 / 宝石的颗数，1–9 颗'),
        trait('形制', '八面体、三棱锥、六棱柱、莲座、螺旋、月牙'),
        trait('底座', '有底座 / 无底座'),
      ),
      h(
        'p',
        { class: 'guide-callout' },
        h('strong', { text: '仿品不是"一眼假"。' }),
        ' 做伪通常只改一到两项，其余特征仍然一致；难度越高，改得越隐蔽、真品越少。',
      ),
    ),
    section(
      '精灵知道什么、不知道什么',
      h(
        'div',
        { class: 'guide-split' },
        h(
          'div',
          { class: 'guide-split__col' },
          h('h3', { class: 'guide-split__title is-yes', text: '它知道' }),
          h(
            'ul',
            { class: 'bullets' },
            h('li', { text: '创作人的手艺规矩、真品规范与坊间传闻' }),
            h('li', { text: '世界物价、当地人对哪些物件有偏见' }),
            h('li', { text: '哪类做伪手法在这座城最常见（但不点名）' }),
          ),
        ),
        h(
          'div',
          { class: 'guide-split__col' },
          h('h3', { class: 'guide-split__title is-no', text: '它不知道' }),
          h(
            'ul',
            { class: 'bullets' },
            h('li', { text: '某一件具体珍宝是真还是假' }),
            h('li', { text: '某一件的底价、真值或摊主的心理价位' }),
            h('li', { text: '直接问"哪件是真的"会被防火墙挡回，额度照扣' }),
          ),
        ),
      ),
    ),
    section(
      '钱与额度',
      h(
        'dl',
        { class: 'guide-facts' },
        ...FACTS.flatMap(([label, value]) => [h('dt', { text: label }), h('dd', { text: value })]),
      ),
      h('p', {
        class: 'guide-note',
        text: '真伪、砍价与结算全部由本地确定性代码判定，模型只负责生成内容与台词；同一局的结果可复现。',
      }),
    ),
    section(
      '操作与小技巧',
      h(
        'ul',
        { class: 'bullets' },
        h('li', { text: '验货页：拖动旋转、滚轮缩放、双击回正；数颗数时把模型转到正面。' }),
        h('li', { text: '砍价：拖滑块或填整数，出价不能高于标价，也不能超过手里资金。' }),
        h('li', { text: '精灵：问题 ≤50 字、回答 ≤100 字；先问创作人规矩，再问具体疑点。' }),
        h('li', {
          text: '想要更快的节奏：设置里打开「快速议价」，摊主反应改用本地公式与台词池。',
        }),
      ),
    ),
    section(
      'Key 与隐私',
      h('p', {
        class: 'guide-lead',
        text: '两把 Key（DeepSeek / Lux3D）只存在这台设备的浏览器里，请求直接发往官方接口，不经过任何服务器。',
      }),
      h(
        'div',
        { class: 'actions-row' },
        button('去设置 Key', { variant: 'ghost', onClick: () => navigate('settings') }),
        button('返回开始页', { variant: 'subtle', onClick: () => navigate('start') }),
      ),
    ),
    h(
      'div',
      { class: 'actions-row guide-cta' },
      button('进入教学关卡', { variant: 'primary', onClick: () => startTutorial() }),
      h('span', { class: 'muted', text: '约 3 分钟 · 0 积分 · 无需 Key' }),
    ),
  );
}

function step(index: string, title: string, desc: string): HTMLElement {
  return h(
    'li',
    { class: 'guide-step' },
    h('span', { class: 'guide-step__num', text: index }),
    h(
      'span',
      { class: 'guide-step__body' },
      h('strong', { class: 'guide-step__title', text: title }),
      h('span', { class: 'guide-step__desc', text: desc }),
    ),
  );
}

function trait(label: string, hint: string): HTMLElement {
  return h(
    'div',
    { class: 'guide-trait' },
    h('span', { class: 'guide-trait__label', text: label }),
    h('span', { class: 'guide-trait__hint', text: hint }),
  );
}

const FACTS: Array<[string, string]> = [
  ['起始资金', '1,000 星际币'],
  ['每关珍宝', '5 件'],
  ['标价总和', '约为资金的 1.5–2.2 倍（不可能全买）'],
  ['议价额度', '10 次/关，每级 +5'],
  ['单件回合', '最多 4 回合，之后流拍'],
  ['询问额度', '5 次/关，每级 +2'],
  ['回收手续费', '20 星际币/件'],
  ['仿品残值', '标价 × 10%'],
];
