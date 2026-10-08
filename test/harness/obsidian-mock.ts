// Минимальная заглушка Obsidian API для визуальной проверки в браузере.
import momentLib from 'moment';
export const moment = momentLib;

// DOM-хелперы, которые Obsidian добавляет в HTMLElement.
const P = HTMLElement.prototype as any;
function applyOpts(el: HTMLElement, o: any) {
  if (typeof o === 'string') { el.className = o; return; }
  if (!o) return;
  if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(' ') : o.cls;
  if (o.text !== undefined) el.textContent = String(o.text);
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
export class Modal { titleEl = document.createElement('div'); contentEl = document.createElement('div'); constructor(public app: any) {} open() {} close() {} onClose() {} }
export class Setting { constructor(_: any) {} addButton() { return this; } addToggle() { return this; } setName() { return this; } setDesc() { return this; } }
export class PluginSettingTab { constructor(public app: any, public plugin: any) {} }
export class Plugin {
  constructor(public app: any, public manifest: any) {}
  registerEvent() {} registerView() {} registerHoverLinkSource() {} addRibbonIcon() {} addCommand() {} addSettingTab() {} registerInterval() {}
  async loadData() { return {}; } async saveData() {}
}
export function setIcon(el: HTMLElement, name: string) { el.textContent = name === 'circle' ? '○' : '✔'; }
export class AbstractInputSuggest { constructor(public app: any, _el: any) {} close() {} }
export class ItemView {
  contentEl = document.createElement('div');
  app: any;
  constructor(public leaf: any) { this.app = leaf.app; }
  registerEvent() {} registerInterval() {}
  registerDomEvent(el: HTMLElement, ev: string, cb: any) { el.addEventListener(ev, cb); }
  getState() { return {}; } async setState() {}
}
