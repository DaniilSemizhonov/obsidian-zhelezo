import { App, normalizePath, Notice, TFile } from 'obsidian';
import { createDailyNote, getAllDailyNotes, getDailyNote, getDateFromFile } from 'obsidian-daily-notes-interface';
import { addEntry, Done, entryLine, HistoryItem, nextWorkout, parseEntries } from './journal';
import { moment } from './moment';
import { Field, findLegacyBlock, LegacyData, migrateNote, parsePlan, Plan, setCell } from './plan';
import type WorkoutPlugin from './main';

export type PlanState =
  | { kind: 'none' }
  | { kind: 'missing'; path: string }
  | { kind: 'legacy'; file: TFile }
  | { kind: 'empty'; file: TFile }
  | { kind: 'ok'; file: TFile; plan: Plan };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class PlanStore {
  constructor(private app: App, private plugin: WorkoutPlugin) {}

  planFile(): TFile | null {
    const path = this.plugin.settings.planPath;
    const f = path ? this.app.vault.getAbstractFileByPath(path) : null;
    return f instanceof TFile ? f : null;
  }

  async state(): Promise<PlanState> {
    const path = this.plugin.settings.planPath;
    if (!path) return { kind: 'none' };
    const file = this.planFile();
    if (!file) return { kind: 'missing', path };
    const text = await this.app.vault.cachedRead(file);
    const plan = parsePlan(text);
    if (plan.workouts.length) return { kind: 'ok', file, plan };
    return findLegacyBlock(text) ? { kind: 'legacy', file } : { kind: 'empty', file };
  }

  async setCell(w: number, e: number, mc: number, field: Field, value: string) {
    const file = this.planFile();
    if (!file) throw new Error('заметка плана не найдена');
    await this.app.vault.process(file, (text) => setCell(text, w, e, mc, field, value));
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

    await vault.process(file, (current) => migrateNote(current, data!));
  }

  // ---------- Дневник ----------

  /** Ссылка на план для строки в дневнике: [[Имя|план]]. */
  private planLink(file: TFile, from: TFile): string {
    const link = this.app.metadataCache.fileToLinktext(file, from.path, true);
    return `[[${link}|план]]`;
  }

  /** Тренировки из заметок, которые ссылаются на план (это и есть ежедневные заметки). */
  async history(plan: Plan): Promise<HistoryItem[]> {
    const file = this.planFile();
    if (!file) return [];
    const names = plan.workouts.map((w) => w.name);
    const items: HistoryItem[] = [];
    const links = this.app.metadataCache.resolvedLinks;
    for (const source of Object.keys(links)) {
      if (!links[source]?.[file.path]) continue;
      const note = this.app.vault.getAbstractFileByPath(source);
      if (!(note instanceof TFile)) continue;
      const entries = parseEntries(await this.app.vault.cachedRead(note), names);
      if (!entries.length) continue;
      const date = (getDateFromFile(note, 'day') ?? moment(note.stat.ctime)).format('YYYY-MM-DD');
      for (const d of entries) items.push({ ...d, date, path: note.path });
    }
    return items.sort((a, b) => b.date.localeCompare(a.date) || b.mc - a.mc || b.workout - a.workout);
  }

  /** Последняя тренировка, где уже вписан хоть один вес (до появления истории). */
  lastWithWeights(plan: Plan): Done | null {
    let best: Done | null = null;
    plan.workouts.forEach((w, wi) => {
      for (const ex of w.exercises) {
        for (const r of ex.rows) {
          // «ИВН 8-9…» — указание из плана, а не вписанный вес.
          if (!r.weight || /^ИВН/i.test(r.weight)) continue;
          if (!best || r.mc > best.mc || (r.mc === best.mc && wi + 1 > best.workout)) best = { mc: r.mc, workout: wi + 1 };
        }
      }
    });
    return best;
  }

  suggest(plan: Plan, history: HistoryItem[]): Done {
    return nextWorkout(history, this.lastWithWeights(plan), plan.mcNames.length, plan.workouts.length);
  }

  /** Записывает тренировку в сегодняшнюю заметку (создаёт её при необходимости). */
  async logToday(plan: Plan, done: Done): Promise<{ file: TFile; added: boolean }> {
    const planFile = this.planFile();
    if (!planFile) throw new Error('заметка плана не найдена');
    const today = moment();

    let daily: TFile | null = null;
    try {
      daily = getDailyNote(today, getAllDailyNotes()) ?? null;
    } catch {
      daily = null;
    }
    if (!daily) {
      daily = (await createDailyNote(today)) ?? null;
      if (!daily) throw new Error('не удалось создать ежедневную заметку');
      await this.waitForTemplater(daily);
    }

    const workout = plan.workouts[done.workout - 1];
    const line = entryLine(done.mc, workout.name, this.planLink(planFile, daily));
    const pattern = this.plugin.settings.habitPattern.trim();
    let habit: RegExp | null = null;
    try {
      habit = pattern ? new RegExp(pattern, 'i') : null;
    } catch {
      new Notice('Тренировки: неверное выражение для привычки в настройках');
    }

    let added = false;
    await this.app.vault.process(daily, (text) => {
      const res = addEntry(text, line, done, plan.workouts.map((w) => w.name), habit);
      added = res.added;
      return res.text;
    });
    return { file: daily, added };
  }

  /** Templater заполняет шаблон новой заметки асинхронно — ждём, чтобы не затереть друг друга. */
  private async waitForTemplater(file: TFile) {
    for (let i = 0; i < 30; i++) {
      const text = await this.app.vault.read(file);
      if (!text.includes('<%')) return;
      await sleep(100);
    }
  }
}
