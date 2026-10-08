import { moment, notices, TFile, TFolder } from './obsidian-mock';
import WorkoutPlugin from '../../src/main';
import { WorkoutView } from '../../src/view';
declare const NOTE: string;
declare const DATA: string;
declare const DAILY_TEMPLATE: string;

const PLAN = 'Здоровье/План для тестов.md';
const DIARY = 'Дневник';
const files: Record<string, string> = {
  [PLAN]: NOTE,
  'Здоровье/План для тестов-data.json': DATA,
  // Вчерашняя тренировка уже записана.
  [`${DIARY}/${moment().subtract(1, 'day').format('YYYY.MM.DD')}.md`]: `## Привычки\n- [x] 🏃 Физическая активность\n\t- 🏋️ МЦ2 · Тренировка 1: низ · [[План для тестов|план]]\n`,
};
const tfile = (p: string) => {
  const f = new TFile(p);
  f.parent = { path: p.split('/').slice(0, -1).join('/'), isRoot: () => !p.includes('/') };
  return f;
};
const app: any = {
  vault: {
    getMarkdownFiles: () => Object.keys(files).filter((p) => p.endsWith('.md')).map(tfile),
    cachedRead: async (f: TFile) => files[f.path],
    read: async (f: TFile) => files[f.path],
    getAbstractFileByPath: (p: string) =>
      p === DIARY ? new TFolder(p, Object.keys(files).filter((x) => x.startsWith(`${DIARY}/`)).map(tfile)) : p in files ? tfile(p) : null,
    process: async (f: TFile, fn: (t: string) => string) => {
      files[f.path] = fn(files[f.path]);
    },
    create: async (p: string, data: string) => {
      files[p] = data;
      return tfile(p);
    },
    createFolder: async () => {},
    on: () => ({}),
    adapter: { exists: async (p: string) => p in files, read: async (p: string) => files[p] },
  },
  metadataCache: {
    on: () => ({}),
    fileToLinktext: (f: TFile) => f.basename,
    getFirstLinkpathDest: () => null,
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
  // Сегодняшняя заметка уже есть (по шаблону с привычками).
  files[`${DIARY}/${moment().format('YYYY.MM.DD')}.md`] = DAILY_TEMPLATE;

  const view = new WorkoutView({ app }, plugin);
  document.getElementById('root')!.appendChild(view.contentEl);
  await view.onOpen();
  (window as any).__h = { plugin, files, notices, view, PLAN, DIARY, today: moment().format('YYYY.MM.DD') };
  document.body.dataset.ready = '1';
})();
