import { moment, notices, TFile, TFolder } from './obsidian-mock';
import WorkoutPlugin from '../../src/main';
import { WorkoutView } from '../../src/view';
declare const NOTE: string;
declare const DATA: string;
declare const DAILY_TEMPLATE: string;

const PLAN = 'Здоровье/План для тестов.md';
const DIARY = 'Дневник';
const day = (n: number) => moment().subtract(n, 'day').format('YYYY.MM.DD');
const files: Record<string, string> = {
  [PLAN]: NOTE,
  'Здоровье/План для тестов-data.json': DATA,
  // Вчера тренировка записана прошлой версией плагина — строкой в дневнике.
  [`${DIARY}/${day(1)}.md`]: `## Привычки\n- [x] 🏃 Физическая активность\n\t- 🏋️ МЦ2 · Тренировка 1: низ · [[План для тестов|план]]\n`,
  [`${DIARY}/${day(3)}.md`]: DAILY_TEMPLATE,
};
const fm = (t: string): Record<string, string> | undefined => {
  const m = /^---\n([\s\S]*?)\n---/.exec(t);
  if (!m) return undefined;
  const o: Record<string, string> = {};
  for (const l of m[1].split('\n')) {
    const k = /^([\w-]+):\s*(.*)$/.exec(l);
    if (k) o[k[1]] = k[2];
  }
  return o;
};
const tfile = (p: string) => {
  const f = new TFile(p);
  (f as any).stat = { ctime: Date.now(), mtime: Date.now() };
  f.parent = { path: p.split('/').slice(0, -1).join('/'), isRoot: () => !p.includes('/') };
  return f;
};
const handlers: ((f: TFile) => void)[] = [];
// Как в Obsidian: после записи файла метаданные обновляются и приходит событие changed.
const changed = (p: string) => setTimeout(() => handlers.forEach((h) => h(tfile(p))), 20);
const app: any = {
  vault: {
    getMarkdownFiles: () => Object.keys(files).filter((p) => p.endsWith('.md')).map(tfile),
    cachedRead: async (f: TFile) => files[f.path],
    read: async (f: TFile) => files[f.path],
    getAbstractFileByPath: (p: string) =>
      p === DIARY || p === 'Здоровье'
        ? new TFolder(p, Object.keys(files).filter((x) => x.startsWith(`${p}/`)).map(tfile))
        : p in files ? tfile(p) : null,
    process: async (f: TFile, fn: (t: string) => string) => {
      files[f.path] = fn(files[f.path]);
      changed(f.path);
    },
    create: async (p: string, data: string) => {
      files[p] = data;
      return tfile(p);
    },
    createFolder: async () => {},
    on: () => ({}),
    adapter: { exists: async (p: string) => p in files, read: async (p: string) => files[p] },
  },
  fileManager: {
    processFrontMatter: async (f: TFile, fn: (o: any) => void) => {
      const o = fm(files[f.path]) ?? {};
      fn(o);
      const yaml = Object.entries(o).map(([k, v]) => `${k}: ${v}`).join('\n');
      files[f.path] = /^---\n[\s\S]*?\n---/.test(files[f.path]) ? files[f.path].replace(/^---\n[\s\S]*?\n---/, `---\n${yaml}\n---`) : `---\n${yaml}\n---\n${files[f.path]}`;
    },
  },
  metadataCache: {
    on: (name: string, h: (f: TFile) => void) => {
      if (name === 'changed') handlers.push(h);
      return {};
    },
    fileToLinktext: (f: TFile) => f.basename,
    getFileCache: (f: TFile) => ({ frontmatter: fm(files[f.path] ?? '') }),
    get resolvedLinks() {
      const out: Record<string, Record<string, number>> = {};
      for (const [p, t] of Object.entries(files)) if (t.includes('[[План для тестов')) out[p] = { [PLAN]: 1 };
      return out;
    },
  },
  workspace: { getActiveFile: () => tfile(PLAN), getLeaf: () => ({ openFile: async () => {} }), getLeavesOfType: () => [], revealLeaf: async () => {} },
  internalPlugins: {
    plugins: { 'daily-notes': { enabled: true } },
    getPluginById: () => ({ enabled: true, instance: { options: { format: 'YYYY.MM.DD', folder: DIARY, template: '' } } }),
  },
  plugins: { getPlugin: () => null, plugins: {} },
  foldManager: { load: () => null },
};
(window as any).app = app;
(window as any).moment = moment;

(async () => {
  const plugin = new WorkoutPlugin(app, { id: 'zhelezo' });
  await plugin.loadSettings();
  const { PlanStore } = await import('../../src/store');
  plugin.store = new PlanStore(app, plugin);
  plugin.settings.planPath = PLAN;
  files[`${DIARY}/${day(0)}.md`] = DAILY_TEMPLATE;
  const view = new WorkoutView({ app }, plugin);
  document.getElementById('root')!.appendChild(view.contentEl);
  await view.onOpen();
  (window as any).__h = { plugin, files, notices, view, PLAN, DIARY, day };
  document.body.dataset.ready = '1';
})();
