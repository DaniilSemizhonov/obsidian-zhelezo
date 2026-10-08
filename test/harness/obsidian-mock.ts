// Минимальная заглушка Obsidian API для визуальной проверки в браузере.
import momentLib from 'moment';
export const moment = momentLib;

// DOM-хелперы, которые Obsidian добавляет в HTMLElement.
const P = HTMLElement.prototype as any;
function applyOpts(el: HTMLElement, o: any) {
  if (typeof o === 'string') { el.className = o; return; }
  if (!o) return;
  if (o.cls) for (const c of Array.isArray(o.cls) ? o.cls : o.cls.split(' ')) el.classList.add(c);
  if (o.text !== undefined) el.textContent = String(o.text);
  if (o.value !== undefined) (el as any).value = o.value;
  if (o.type !== undefined) (el as any).type = o.type;
  if (o.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, String(v));
}
P.createEl = function (tag: string, o?: any) { const el = document.createElement(tag); applyOpts(el, o); this.appendChild(el); return el; };
P.createDiv = function (o?: any) { return this.createEl('div', o); };
P.createSpan = function (o?: any) { return this.createEl('span', o); };
P.empty = function () { this.innerHTML = ''; };
P.addClass = function (...c: string[]) { this.classList.add(...c); };
P.removeClass = function (...c: string[]) { this.classList.remove(...c); };
P.toggleClass = function (c: string, v: boolean) { this.classList.toggle(c, v); };
P.setText = function (t: string) { this.textContent = t; };
P.setAttr = function (k: string, v: string) { this.setAttribute(k, v); };
P.toggle = function (v: boolean) { this.style.display = v ? '' : 'none'; };

export class Events {
  private h: Record<string, Function[]> = {};
  on(n: string, f: Function) { (this.h[n] ??= []).push(f); return { n, f }; }
  trigger(n: string, ...a: any[]) { for (const f of this.h[n] ?? []) f(...a); }
}
export class TFile { stat = { ctime: Date.now() }; parent: any = null; constructor(public path: string) {} get basename() { return this.path.split('/').pop()!.replace(/\.md$/, ''); } get extension() { return this.path.split('.').pop(); } }
export class TFolder { constructor(public path: string, public children: any[] = []) {} }
export class Vault {
  static recurseChildren(folder: any, cb: (f: any) => void) { for (const c of folder.children) { cb(c); if (c instanceof TFolder) Vault.recurseChildren(c, cb); } }
}
export const normalizePath = (p: string) => p;
export const Keymap = { isModEvent: (e: MouseEvent) => e.ctrlKey || e.metaKey };
export function debounce(f: Function, _ms: number) { return (...a: any[]) => f(...a); }
export const notices: string[] = [];
export class Notice { constructor(m: string) { notices.push(m); console.log('NOTICE', m); } }
export class Modal {
  modalEl = document.createElement('div');
  titleEl = document.createElement('h3');
  contentEl = document.createElement('div');
  constructor(public app: any) {
    this.modalEl.className = 'modal mock-modal';
    this.modalEl.append(this.titleEl, this.contentEl);
  }
  open() { document.body.appendChild(this.modalEl); }
  close() { this.modalEl.remove(); this.onClose(); }
  onClose() {}
}
export class Menu {
  el = document.createElement('div');
  constructor() { this.el.className = 'menu mock-menu'; }
  addItem(cb: (i: any) => void) {
    const b = document.createElement('div');
    b.className = 'menu-item';
    const item: any = { setTitle: (t: string) => { b.textContent = t; return item; }, setIcon: () => item, onClick: (f: any) => { b.onclick = () => { this.el.remove(); f(); }; return item; } };
    cb(item); this.el.appendChild(b); return this;
  }
  addSeparator() { return this; }
  showAtMouseEvent() { document.body.appendChild(this.el); }
}
export class Setting {
  settingEl = document.createElement('div');
  constructor(parent: HTMLElement) { this.settingEl.className = 'setting-item'; parent.appendChild(this.settingEl); (this.settingEl as any).toggle = (v: boolean) => (this.settingEl.style.display = v ? '' : 'none'); }
  setName(t: string) { const n = document.createElement('div'); n.className = 'setting-item-name'; n.textContent = t; this.settingEl.appendChild(n); return this; }
  setDesc() { return this; }
  setHeading() { return this; }
  addButton(cb: (b: any) => void) {
    const el = document.createElement('button'); this.settingEl.appendChild(el);
    const b: any = { buttonEl: el, setButtonText: (t: string) => { el.textContent = t; return b; }, setCta: () => b, setWarning: () => b, onClick: (f: any) => { el.onclick = f; return b; } };
    cb(b); return this;
  }
  addText(cb: (t: any) => void) {
    const el = document.createElement('input'); this.settingEl.appendChild(el);
    const t: any = { inputEl: el, setValue: (v: string) => { el.value = v; return t; }, setPlaceholder: (v: string) => { el.placeholder = v; return t; }, onChange: (f: any) => { el.addEventListener('input', () => f(el.value)); return t; } };
    cb(t); return this;
  }
  addDropdown(cb: (d: any) => void) {
    const el = document.createElement('select'); this.settingEl.appendChild(el);
    const d: any = { selectEl: el, addOption: (v: string, l: string) => { const o = document.createElement('option'); o.value = v; o.textContent = l; el.appendChild(o); return d; }, setValue: (v: string) => { el.value = v; return d; }, onChange: (f: any) => { el.addEventListener('change', () => f(el.value)); return d; } };
    cb(d); return this;
  }
  addToggle() { return this; }
}
export class PluginSettingTab { constructor(public app: any, public plugin: any) {} }
export class Plugin {
  constructor(public app: any, public manifest: any) {}
  registerEvent() {} registerView() {} registerHoverLinkSource() {} addRibbonIcon() {} addCommand() {} addSettingTab() {} registerInterval() {}
  async loadData() { return {}; } async saveData() {}
}
const ICONS: Record<string, string> = { circle: '○', 'check-circle-2': '✔', dumbbell: '🏋', 'list-ordered': '☰', 'calendar-check': '🗓', 'trending-up': '📈', 'chevron-down': '▾', plus: '+', minus: '−', 'arrow-left': '←', 'arrow-right': '→', 'arrow-up': '↑', 'arrow-down': '↓', copy: '⧉', 'trash-2': '🗑', calendar: '📅', x: '✕', check: '✓', 'skip-forward': '⏭' };
export function setIcon(el: HTMLElement, name: string) { el.textContent = ICONS[name] ?? '•'; el.dataset.icon = name; }
export class AbstractInputSuggest { constructor(public app: any, _el: any) {} close() {} }
export class ItemView {
  contentEl = document.createElement('div');
  app: any;
  constructor(public leaf: any) { this.app = leaf.app; }
  registerEvent() {} registerInterval() {}
  registerDomEvent(el: HTMLElement, ev: string, cb: any) { el.addEventListener(ev, cb); }
  getState() { return {}; } async setState() {}
}
