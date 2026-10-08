import { App, normalizePath, Notice, TFile } from 'obsidian';
import { createDailyNote, getAllDailyNotes, getDailyNote, getDateFromFile } from 'obsidian-daily-notes-interface';
import * as E from './edit';
import { addEntry, Done, entryLine, nextWorkout, parseEntries, removeEntry } from './journal';
import type WorkoutPlugin from './main';
import { moment } from './moment';
import { Field, findLegacyBlock, JournalRow, LegacyData, migrateNote, mutatePlan, newPlanText, parsePlan, Plan, setCell, Status } from './plan';

export type PlanState =
  | { kind: 'none' }
  | { kind: 'missing'; path: string }
  | { kind: 'legacy'; file: TFile }
  | { kind: 'empty'; file: TFile }
  | { kind: 'ok'; file: TFile; plan: Plan };

export interface PlanInfo {
  file: TFile;
  archived: boolean;
}

const FM_KEY = 'zhelezo';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const todayIso = () => moment().format('YYYY-MM-DD');

export class PlanStore {
  private marking = new Set<string>();

  constructor(private app: App, private plugin: WorkoutPlugin) {}

  // ---------- Планы ----------

  planFile(): TFile | null {
    const path = this.plugin.settings.planPath;
    const f = path ? this.app.vault.getAbstractFileByPath(path) : null;
    return f instanceof TFile ? f : null;
  }

  /** Все планы: заметки с `zhelezo:` во frontmatter (плюс текущий, даже если метки ещё нет). */
  plans(): PlanInfo[] {
    const out: PlanInfo[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      const v = this.app.metadataCache.getFileCache(f)?.frontmatter?.[FM_KEY];
      if (v === undefined && f.path !== this.plugin.settings.planPath) continue;
      out.push({ file: f, archived: v === 'done' || v === 'archived' });
    }
    return out.sort((a, b) => Number(a.archived) - Number(b.archived) || b.file.stat.mtime - a.file.stat.mtime);
  }

  async setStatus(file: TFile, status: 'active' | 'done') {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[FM_KEY] = status;
    });
  }

  async use(file: TFile) {
    this.plugin.settings.planPath = file.path;
    await this.plugin.saveSettings();
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (fm?.[FM_KEY] === undefined) await this.setStatus(file, 'active');
  }

  async createPlan(title: string, folder: string, mcCount: number, copyFrom?: TFile): Promise<TFile> {
    const from = copyFrom ? parsePlan(await this.app.vault.read(copyFrom)) : undefined;
    const safe = title.replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim() || 'План тренировок';
    let path = normalizePath(`${folder ? `${folder}/` : ''}${safe}.md`);
    for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) path = normalizePath(`${folder ? `${folder}/` : ''}${safe} ${i}.md`);
    if (folder && !this.app.vault.getAbstractFileByPath(normalizePath(folder))) await this.app.vault.createFolder(normalizePath(folder));
    return this.app.vault.create(path, newPlanText(safe, mcCount, todayIso(), from));
  }

  async state(): Promise<PlanState> {
    const path = this.plugin.settings.planPath;
    if (!path) return { kind: 'none' };
    const file = this.planFile();
    if (!file) return { kind: 'missing', path };
    const text = await this.app.vault.cachedRead(file);
    const plan = parsePlan(text);
    if (plan.workouts.length || plan.hasJournal) {
      // План, выбранный в первой версии, мог остаться без метки — без неё он пропадёт из списка планов.
      if (this.app.metadataCache.getFileCache(file)?.frontmatter?.[FM_KEY] === undefined && !this.marking.has(file.path)) {
        this.marking.add(file.path);
        this.setStatus(file, 'active').finally(() => this.marking.delete(file.path));
      }
      return { kind: 'ok', file, plan };
    }
    return findLegacyBlock(text) ? { kind: 'legacy', file } : { kind: 'empty', file };
  }

  // ---------- Правки плана ----------

  async setCell(w: number, e: number, mc: number, field: Field, value: string) {
    const file = this.planFile();
    if (!file) throw new Error('заметка плана не найдена');
    await this.app.vault.process(file, (text) => setCell(text, w, e, mc, field, value));
  }

  /** Любая структурная правка: разобрать → изменить → собрать, атомарно. */
  async edit(fn: (plan: Plan) => void) {
    const file = this.planFile();
    if (!file) throw new Error('заметка плана не найдена');
    await this.app.vault.process(file, (text) => mutatePlan(text, fn));
  }

  // ---------- Журнал + ежедневные заметки ----------

  private habit(): RegExp | null {
    const pattern = this.plugin.settings.habitPattern.trim();
    try {
      return pattern ? new RegExp(pattern, 'i') : null;
    } catch {
      new Notice('Железо: неверное выражение для привычки в настройках');
      return null;
    }
  }

  private dailyFor(iso: string): TFile | null {
    try {
      return getDailyNote(moment(iso, 'YYYY-MM-DD'), getAllDailyNotes()) ?? null;
    } catch {
      return null;
    }
  }

  /** Заметка дня; сегодняшнюю при необходимости создаём, прошлые — нет. */
  private async dailyNote(iso: string, create: boolean): Promise<TFile | null> {
    const existing = this.dailyFor(iso);
    if (existing || !create) return existing;
    const file = (await createDailyNote(moment(iso, 'YYYY-MM-DD'))) ?? null;
    if (file) await this.waitForTemplater(file);
    return file;
  }

  /** Templater заполняет шаблон новой заметки асинхронно — ждём, чтобы не затереть друг друга. */
  private async waitForTemplater(file: TFile) {
    for (let i = 0; i < 30; i++) {
      if (!(await this.app.vault.read(file)).includes('<%')) return;
      await sleep(100);
    }
  }

  private async addToDaily(plan: Plan, row: JournalRow): Promise<TFile | null> {
    const planFile = this.planFile();
    if (!planFile || row.status !== 'done') return null;
    const daily = await this.dailyNote(row.date, row.date === todayIso());
    if (!daily) return null;
    const link = `[[${this.app.metadataCache.fileToLinktext(planFile, daily.path, true)}|план]]`;
    const line = entryLine(row.mc, plan.workouts[row.workout - 1].name, link);
    const names = plan.workouts.map((w) => w.name);
    await this.app.vault.process(daily, (text) => addEntry(text, line, row, names, this.habit()).text);
    return daily;
  }

  private async removeFromDaily(plan: Plan, row: JournalRow) {
    const daily = this.dailyFor(row.date);
    if (!daily) return;
    const names = plan.workouts.map((w) => w.name);
    await this.app.vault.process(daily, (text) => removeEntry(text, row, names).text);
  }

  /**
   * Строки 🏋️ из ежедневных заметок, которых нет в журнале плана, —
   * чтобы история, записанная до появления журнала, не потерялась.
   */
  private async dailyHistory(plan: Plan): Promise<JournalRow[]> {
    const file = this.planFile();
    if (!file) return [];
    const names = plan.workouts.map((w) => w.name);
    const rows: JournalRow[] = [];
    const links = this.app.metadataCache.resolvedLinks;
    for (const source of Object.keys(links)) {
      if (!links[source]?.[file.path]) continue;
      const note = this.app.vault.getAbstractFileByPath(source);
      if (!(note instanceof TFile)) continue;
      const entries = parseEntries(await this.app.vault.cachedRead(note), names);
      if (!entries.length) continue;
      const date = (getDateFromFile(note, 'day') ?? moment(note.stat.ctime)).format('YYYY-MM-DD');
      for (const d of entries) rows.push({ ...d, date, status: 'done', note: '' });
    }
    return rows;
  }

  /** Отметить тренировку (сделана/пропущена) на дату. */
  async log(plan: Plan, done: Done, date: string, status: Status, note = ''): Promise<TFile | null> {
    const row: JournalRow = { ...done, date, status, note };
    const imported = plan.journal.length ? [] : await this.dailyHistory(plan);
    // Если раньше эта тренировка стояла на другую дату — убрать её строку из той заметки дня.
    const previous = plan.journal.find((j) => j.mc === done.mc && j.workout === done.workout && j.date !== date);
    await this.edit((p) => {
      for (const r of imported) E.addJournal(p, r);
      E.addJournal(p, row);
    });
    if (previous) await this.removeFromDaily(plan, previous);
    return this.addToDaily(plan, row);
  }

  async unlog(plan: Plan, row: JournalRow) {
    await this.edit((p) => E.removeJournal(p, row));
    await this.removeFromDaily(plan, row);
  }

  async move(plan: Plan, row: JournalRow, date: string) {
    if (date === row.date) return;
    await this.edit((p) => E.moveJournal(p, row, date));
    await this.removeFromDaily(plan, row);
    await this.addToDaily(plan, { ...row, date });
  }

  /** Журнал плана + записи из ежедневных заметок, которых ещё нет в журнале (до первой записи). */
  async journal(plan: Plan): Promise<JournalRow[]> {
    const rows = [...plan.journal];
    if (!rows.length) rows.push(...(await this.dailyHistory(plan)));
    return rows.sort((a, b) => b.date.localeCompare(a.date) || b.mc - a.mc || b.workout - a.workout);
  }

  /** Последняя тренировка, где уже вписан хоть один вес (пока журнала нет). */
  lastWithWeights(plan: Plan): Done | null {
    let best: Done | null = null;
    plan.workouts.forEach((w, wi) => {
      for (const ex of w.exercises) {
        for (const r of ex.rows) {
          if (!r.weight || /^ИВН/i.test(r.weight)) continue;
          if (!best || r.mc > best.mc || (r.mc === best.mc && wi + 1 > best.workout)) best = { mc: r.mc, workout: wi + 1 };
        }
      }
    });
    return best;
  }

  suggest(plan: Plan, journal: JournalRow[]): Done | null {
    return nextWorkout(journal, this.lastWithWeights(plan), plan.mcNames.length, plan.workouts.length);
  }

  // ---------- Перенос из dataviewjs ----------

  legacyDataPath(file: TFile): string {
    const dir = file.parent && !file.parent.isRoot() ? `${file.parent.path}/` : '';
    return normalizePath(`${dir}${file.basename}-data.json`);
  }

  async migrate(file: TFile) {
    const { vault } = this.app;
    const text = await vault.read(file);
    const block = findLegacyBlock(text);
    if (!block) throw new Error('в заметке нет блока dataviewjs с планом');
    // Веса живут в «<заметка>-data.json»; если его нет — берём план из самого блока.
    let data: LegacyData | null = block.defaults;
    const jsonPath = this.legacyDataPath(file);
    if (await vault.adapter.exists(jsonPath)) data = JSON.parse(await vault.adapter.read(jsonPath));
    if (!data) throw new Error('не удалось прочитать данные плана');
    await vault.process(file, (current) => mutatePlan(migrateNote(current, data!), () => {}));
  }
}
