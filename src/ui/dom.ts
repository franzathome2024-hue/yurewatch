/**
 * Minimal DOM helpers. No framework: the whole UI is a handful of components
 * that own a subtree and re-render it from immutable state. That keeps the
 * bundle small enough to inline into a single HTML file for the Android asset,
 * and keeps rendering deterministic for tests.
 */

export type Child = Node | string | number | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | null | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key.startsWith('on') && typeof value === 'string') {
      // Never used with user data; kept out of the API surface otherwise.
      node.setAttribute(key, value);
    } else node.setAttribute(key, String(value));
  }
  append(node, ...children);
  return node;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

export interface Component {
  el: HTMLElement;
  update(state: import('../state/store').AppState): void;
}

/** Create a `<span class="badge">` with a tone modifier. */
export function badge(text: string, tone: 'neutral' | 'info' | 'ok' | 'warn' | 'danger' | 'sim' = 'neutral', extra = ''): HTMLElement {
  return el('span', { class: `badge badge--${tone}${extra ? ` ${extra}` : ''}`, text });
}

/** Accessible disclosure row used by the expandable info sections. */
export function disclosure(props: {
  title: string;
  subtitle?: string;
  tone?: 'neutral' | 'info' | 'warn' | 'danger';
  open?: boolean;
  content: () => HTMLElement;
  id?: string;
}): HTMLElement {
  const wrapper = el('section', { class: `disclosure disclosure--${props.tone ?? 'neutral'}` });
  const body = el('div', { class: 'disclosure__body' });
  const button = el(
    'button',
    {
      class: 'disclosure__toggle',
      type: 'button',
      'aria-expanded': props.open ? 'true' : 'false',
    },
    el('span', { class: 'disclosure__chevron', 'aria-hidden': 'true', text: '›' }),
    el('span', { class: 'disclosure__titles' },
      el('span', { class: 'disclosure__title', text: props.title }),
      props.subtitle ? el('span', { class: 'disclosure__subtitle', text: props.subtitle }) : null,
    ),
  );
  let rendered = false;
  const setOpen = (open: boolean) => {
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    wrapper.classList.toggle('is-open', open);
    if (open && !rendered) {
      body.appendChild(props.content());
      rendered = true;
    }
  };
  button.addEventListener('click', () => setOpen(button.getAttribute('aria-expanded') !== 'true'));
  append(wrapper, button, body);
  if (props.open) setOpen(true);
  return wrapper;
}
