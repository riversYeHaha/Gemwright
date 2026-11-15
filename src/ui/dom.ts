/**
 * 极简 DOM 构造器：不引 UI 框架（方案 §七"不上框架"），
 * 但保留类型安全的标签/属性/事件写法，避免 innerHTML 拼串。
 */

export type Child = Node | string | number | null | undefined | false;

export interface ElProps {
  class?: string;
  text?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  on?: Partial<Record<string, EventListener>>;
  style?: Partial<CSSStyleDeclaration>;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props) {
    if (props.class) element.className = props.class;
    if (props.text !== undefined) element.textContent = props.text;
    if (props.attrs) {
      for (const [key, value] of Object.entries(props.attrs)) {
        if (value === null || value === undefined || value === false) continue;
        element.setAttribute(key, value === true ? '' : String(value));
      }
    }
    if (props.on) {
      for (const [key, handler] of Object.entries(props.on)) {
        if (handler) element.addEventListener(key, handler);
      }
    }
    if (props.style) Object.assign(element.style, props.style);
  }
  appendChildren(element, children);
  return element;
}

export function appendAll(element: HTMLElement, ...children: Child[]): void {
  appendChildren(element, children);
}

function appendChildren(element: HTMLElement, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === 'number' ? String(child) : child);
  }
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function fmt(value: number): string {
  return value.toLocaleString('zh-CN');
}

export function intOf(input: HTMLInputElement | null, fallback = 0): number {
  const value = Number(input?.value ?? '');
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

export function button(
  label: string,
  options: {
    onClick?: EventListener;
    variant?: 'primary' | 'ghost' | 'danger' | 'subtle';
    disabled?: boolean;
    title?: string;
  } = {},
): HTMLButtonElement {
  const el = h('button', {
    class: `btn${options.variant ? ` btn--${options.variant}` : ''}`,
    text: label,
    attrs: { type: 'button', ...(options.title ? { title: options.title } : {}) },
  });
  if (options.disabled) el.disabled = true;
  if (options.onClick) el.addEventListener('click', options.onClick);
  return el;
}

/** 简易 toast 容器（由 router 挂在 app 顶层）。 */
export function toast(message: string, kind: 'info' | 'error' | 'success' = 'info'): void {
  const host = document.querySelector('.toast-host');
  if (!host) return;
  const node = h('div', { class: `toast toast--${kind}`, text: message });
  host.append(node);
  setTimeout(() => {
    node.classList.add('toast--out');
    setTimeout(() => node.remove(), 300);
  }, 2600);
}

/** 打字机：用于精灵台词。节点离屏（重绘）后自动停表。 */
export function typewrite(node: HTMLElement, text: string, speedMs = 18): void {
  const chars = [...text];
  requestAnimationFrame(() => {
    if (!node.isConnected) return;
    node.textContent = '';
    node.classList.add('typewriter');
    let index = 0;
    const timer = setInterval(() => {
      if (!node.isConnected) {
        clearInterval(timer);
        return;
      }
      index += 1;
      node.textContent = chars.slice(0, index).join('');
      if (index >= chars.length) {
        clearInterval(timer);
        node.classList.remove('typewriter');
      }
    }, speedMs);
  });
}
