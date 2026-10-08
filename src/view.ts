import { ItemView, Menu, Notice, setIcon, TFile, WorkspaceLeaf } from 'obsidian';
import * as E from './edit';
import type { Done } from './journal';
import type WorkoutPlugin from './main';
import { confirm, dateModal, logModal, newPlanModal, prompt } from './modals';
import { moment } from './moment';
import type { Exercise, Field, JournalRow, Plan } from './plan';
import { PlanState, todayIso } from './store';

export const VIEW_TYPE = 'workout-panel';

type Tab = 'today' | 'plan' | 'journal' | 'progress';
const TABS: [Tab, string, string][] = [
  ['today', 'Тренировка', 'dumbbell'],
  ['plan', 'План', 'list-ordered'],
  ['journal', 'Журнал', 'calendar-check'],
  ['progress', 'Прогресс', 'trending-up'],
];

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const dayRu = (iso: string) => {
  const m = moment(iso, 'YYYY-MM-DD');
  const diff = moment().startOf('day').diff(m, 'days');
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'вчера';
  return `${m.date()} ${MONTHS_GEN[m.month()]}${m.year() !== moment().year() ? ` ${m.year()}` : ''}`;
};

/** «Тренировка 2» → «Т2», иначе первое слово. */
const chipLabel = (short: string) => {
  const m = /(\d+)\s*$/.exec(short);
  return m ? `Т${m[1]}` : short.split(/\s+/)[0];
};

/** Число из поля «вес»: «46» → 46, «12,5» → 12.5, «С/в/15» → 15, «С/В» → null. */
export const weightNumber = (w: string): number | null => {
  if (/^ИВН/i.test(w)) return null;
  const m = /(\d+(?:[.,]\d+)?)/.exec(w);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
};

const key = (d: Done) => `${d.mc}:${d.workout}`;

/** Всё управление тренировками в одной вкладке — крупно, чтобы было удобно с телефона. */
export class WorkoutView extends ItemView {
  private tab: Tab = 'today';
  private sel: Done | null = null; // выбранная тренировка (вкладки «Тренировка» и «План»)
  private progressEx: string | null = null; // «w:e» для вкладки «Прогресс»
  private pendingRender = false;
  private renderId = 0;

  constructor(leaf: WorkspaceLeaf, private plugin: WorkoutPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return 'Железо';
  }
  getIcon() {
    return 'dumbbell';
  }

  private get store() {
    return this.plugin.store;
  }

  async onOpen() {
    this.contentEl.addClass('zh-view');
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        const plan = this.plugin.settings.planPath;
        if (file.path === plan || this.app.metadataCache.resolvedLinks[file.path]?.[plan]) this.requestRender();
      })
    );
    this.registerEvent(this.app.vault.on('rename', () => this.requestRender()));
    // Перерисовка во время набора сбросила бы клавиатуру — откладываем до ухода из поля.
    this.registerDomEvent(this.contentEl, 'focusout', () => {
      if (this.pendingRender) window.setTimeout(() => this.requestRender(), 0);
    });
    await this.render();
  }

  requestRender() {
    const active = document.activeElement;
    if (this.contentEl.contains(active) && (active instanceof HTMLInputElement || active instanceof HTMLSelectElement)) {
      this.pendingRender = true;
      return;
    }
    this.pendingRender = false;
    this.render();
  }

  /** Действие с уведомлением об ошибке и перерисовкой. */
  private async run(fn: () => Promise<unknown>, ok?: string) {
    try {
      await fn();
      if (ok) new Notice(ok);
    } catch (e) {
      console.error('[zhelezo]', e);
      new Notice(`Железо: ${(e as Error).message}`, 8000);
    }
    this.requestRender();
  }

  // =====================================================================

  async render() {
    // Перерисовки асинхронные и могут пересечься — рисует только последняя.
    const id = ++this.renderId;
    const state = await this.store.state();
    const journal = state.kind === 'ok' ? await this.store.journal(state.plan) : [];
    if (id !== this.renderId) return;

    const el = this.contentEl;
    el.empty();
    this.renderTop(el, state);
    if (state.kind !== 'ok') return this.renderSetup(el, state);

    const { plan, file } = state;
    if (!plan.workouts.length && this.tab === 'today') this.tab = 'plan';
    const suggestion = this.store.suggest(plan, journal);
    if (!this.sel || this.sel.mc > plan.mcNames.length || this.sel.workout > plan.workouts.length) {
      this.sel = suggestion ?? { mc: plan.mcNames.length, workout: Math.max(1, plan.workouts.length) };
    }

    const body = el.createDiv('zh-body');
    if (this.tab === 'today') this.renderToday(body, plan, journal, suggestion);
    else if (this.tab === 'plan') this.renderEditor(body, plan);
    else if (this.tab === 'journal') this.renderJournal(body, plan, journal);
    else this.renderProgress(body, plan, journal);

    const open = body.createDiv('zh-open-plan');
    open.createEl('a', { text: `Открыть заметку «${file.basename}»` }).onclick = () => this.app.workspace.getLeaf(false).openFile(file);
  }

  /** Переключатель планов и вкладки. */
  private renderTop(el: HTMLElement, state: PlanState) {
    const top = el.createDiv('zh-top');
    const name = state.kind === 'ok' || state.kind === 'legacy' || state.kind === 'empty' ? state.file.basename : 'Выберите план';
    const switcher = top.createEl('button', { cls: 'zh-plan-switch' });
    switcher.createSpan({ cls: 'zh-plan-name', text: name });
    setIcon(switcher.createSpan('zh-plan-chevron'), 'chevron-down');
    switcher.onclick = (evt) => this.planMenu(evt, state);

    if (state.kind !== 'ok') return;
    const tabs = el.createDiv('zh-tabs');
    for (const [id, label, icon] of TABS) {
      const b = tabs.createEl('button', { cls: 'zh-tab' });
      b.toggleClass('is-active', id === this.tab);
      setIcon(b.createSpan('zh-tab-icon'), icon);
      b.createSpan({ cls: 'zh-tab-label', text: label });
      b.onclick = () => {
        this.tab = id;
        this.render();
      };
    }
  }

  private planMenu(evt: MouseEvent, state: PlanState) {
    const menu = new Menu();
    const current = this.plugin.settings.planPath;
    const plans = this.store.plans();
    for (const p of plans) {
      menu.addItem((i) =>
        i
          .setTitle(`${p.file.basename}${p.archived ? ' (завершён)' : ''}`)
          .setIcon(p.file.path === current ? 'check' : p.archived ? 'archive' : 'file-text')
          .onClick(() => {
            this.sel = null;
            this.run(() => this.store.use(p.file));
          })
      );
    }
    menu.addSeparator();
    menu.addItem((i) => i.setTitle('Новый план…').setIcon('plus').onClick(() => this.createPlan()));
    menu.addItem((i) =>
      i
        .setTitle('Использовать открытую заметку')
        .setIcon('file-input')
        .onClick(() => {
          const f = this.app.workspace.getActiveFile();
          if (f?.extension === 'md') this.plugin.usePlan(f);
          else new Notice('Сначала откройте заметку с планом');
        })
    );
    if (state.kind === 'ok') {
      const archived = plans.find((p) => p.file.path === current)?.archived;
      menu.addItem((i) =>
        i
          .setTitle(archived ? 'Вернуть план в активные' : 'Завершить план')
          .setIcon(archived ? 'archive-restore' : 'archive')
          .onClick(() => this.run(() => this.store.setStatus(state.file, archived ? 'active' : 'done'), archived ? 'План снова активен' : 'План завершён'))
      );
    }
    menu.showAtMouseEvent(evt);
  }

  private async createPlan() {
    const current = this.store.planFile();
    const plans = this.store.plans().map((p) => p.file);
    const res = await newPlanModal(this.app, plans, current?.parent && !current.parent.isRoot() ? current.parent.path : '');
    if (!res) return;
    await this.run(async () => {
      const file = await this.store.createPlan(res.title, res.folder, res.mcCount, res.copyFrom ?? undefined);
      await this.store.use(file);
      this.sel = null;
      this.tab = 'plan';
    }, 'План создан');
  }

  // =====================================================================
  // Тренировка

  private renderSelectors(el: HTMLElement, plan: Plan, journal: JournalRow[], showDone: boolean) {
    const sel = this.sel!;
    const done = new Set(journal.map(key));
    const mcRow = el.createDiv('zh-chips');
    plan.mcNames.forEach((name, i) => {
      const mc = i + 1;
      const chip = mcRow.createEl('button', { cls: 'zh-chip', text: `МЦ${mc}`, attr: { 'aria-label': name } });
      chip.toggleClass('is-active', mc === sel.mc);
      chip.toggleClass('is-done', showDone && plan.workouts.length > 0 && plan.workouts.every((_, wi) => done.has(`${mc}:${wi + 1}`)));
      chip.onclick = () => this.select({ mc, workout: sel.workout });
    });
    if (!plan.workouts.length) return;
    const wRow = el.createDiv('zh-chips');
    plan.workouts.forEach((w, i) => {
      const chip = wRow.createEl('button', { cls: 'zh-chip', text: chipLabel(w.short), attr: { 'aria-label': w.name } });
      chip.toggleClass('is-active', i + 1 === sel.workout);
      chip.toggleClass('is-done', showDone && done.has(`${sel.mc}:${i + 1}`));
      chip.onclick = () => this.select({ mc: sel.mc, workout: i + 1 });
    });
  }

  private renderToday(el: HTMLElement, plan: Plan, journal: JournalRow[], suggestion: Done | null) {
    const sel = this.sel!;
    const workout = plan.workouts[sel.workout - 1];

    const head = el.createDiv('zh-head');
    const title = head.createDiv('zh-title');
    title.createSpan({ text: `МЦ${sel.mc} · ${workout.short}` });
    if (suggestion && key(sel) === key(suggestion)) title.createSpan({ cls: 'zh-badge', text: 'по плану' });
    head.createDiv({ cls: 'zh-subtitle', text: plan.mcNames[sel.mc - 1] ?? '' });
    const desc = workout.name.slice(workout.short.length).replace(/^\s*:\s*/, '');
    if (desc) head.createDiv({ cls: 'zh-subtitle', text: desc });
    if (!suggestion) head.createDiv({ cls: 'zh-note', text: 'Программа пройдена 🎉 Можно завершить план в меню сверху.' });

    this.renderSelectors(el, plan, journal, true);

    const entry = journal.find((j) => key(j) === key(sel));
    if (entry) {
      el.createDiv({
        cls: `zh-note ${entry.status === 'skipped' ? 'is-skipped' : ''}`,
        text: entry.status === 'skipped' ? `Пропущена: ${dayRu(entry.date)}` : `Сделана: ${dayRu(entry.date)}`,
      });
    }

    const checks = new Set(this.plugin.settings.checks[key(sel)] ?? []);
    const total = workout.exercises.length;
    const progress = el.createDiv('zh-progress');
    progress.createDiv('zh-progress-bar').createDiv('zh-progress-fill').style.width = `${total ? (checks.size / total) * 100 : 0}%`;
    progress.createDiv({ cls: 'zh-progress-text', text: `${checks.size} из ${total}` });

    if (!total) {
      const empty = el.createDiv('zh-empty');
      empty.createSpan({ text: 'В этой тренировке пока нет упражнений. ' });
      empty.createEl('a', { text: 'Добавить в редакторе' }).onclick = () => {
        this.tab = 'plan';
        this.render();
      };
    }

    const list = el.createDiv('zh-list');
    workout.exercises.forEach((ex, ei) => this.renderExercise(list, ex, ei, sel, checks));

    const footer = el.createDiv('zh-footer');
    const finish = footer.createEl('button', { cls: 'mod-cta zh-finish', text: 'Записать тренировку' });
    finish.onclick = () =>
      this.run(async () => {
        const daily = await this.store.log(plan, sel, todayIso(), 'done');
        delete this.plugin.settings.checks[key(sel)];
        await this.plugin.saveSettings();
        this.sel = null; // дальше — следующая по плану
        new Notice(daily ? `Записано в журнал и в «${daily.basename}» 💪` : 'Записано в журнал 💪');
      });
    const more = footer.createDiv('zh-footer-more');
    more.createEl('button', { text: 'Пропустить' }).onclick = () =>
      this.run(async () => {
        await this.store.log(plan, sel, todayIso(), 'skipped');
        this.sel = null;
      }, 'Тренировка пропущена');
    more.createEl('button', { text: 'Другой датой…' }).onclick = async () => {
      const res = await logModal(this.app, plan, sel);
      if (res) await this.run(() => this.store.log(plan, res, res.date, res.status, res.note), 'Сохранено в журнале');
    };
  }

  private renderExercise(list: HTMLElement, ex: Exercise, ei: number, sel: Done, checks: Set<number>) {
    const row = ex.rows.find((r) => r.mc === sel.mc);
    const card = list.createDiv('zh-card');
    const isDone = checks.has(ei);
    card.toggleClass('is-done', isDone);

    const top = card.createDiv('zh-card-top');
    const check = top.createEl('button', { cls: 'zh-check', attr: { 'aria-label': isDone ? 'Снять отметку' : 'Сделано' } });
    setIcon(check, isDone ? 'check-circle-2' : 'circle');
    check.onclick = () => this.toggleCheck(sel, ei);

    const info = top.createDiv('zh-card-info');
    info.createDiv({ cls: 'zh-card-name', text: `${ei + 1}. ${ex.name}` });
    const meta = [row?.sp, ex.rest].filter(Boolean).join(' · ');
    if (meta) info.createDiv({ cls: 'zh-card-meta', text: meta });
    if (!row) return;

    // Вес из прошлого микроцикла — ориентир для прогрессии.
    const prev = [...ex.rows].reverse().find((r) => r.mc < sel.mc && r.weight && !/^ИВН/i.test(r.weight));
    const fields = card.createDiv('zh-fields');
    this.renderInput(fields, 'Вес', row.weight, prev ? `было в МЦ${prev.mc}: ${prev.weight}` : '', sel.workout - 1, ei, sel.mc, 'weight');
    this.renderInput(fields, 'Заметка', row.note, '', sel.workout - 1, ei, sel.mc, 'note');
  }

  private renderInput(parent: HTMLElement, label: string, value: string, hint: string, w: number, e: number, mc: number, field: Field) {
    const wrap = parent.createEl('label', { cls: `zh-field zh-field-${field}` });
    wrap.createSpan({ cls: 'zh-field-label', text: label });
    const input = this.textInput(wrap, value, field === 'weight' ? '—' : '', (v) => this.store.setCell(w, e, mc, field, v));
    input.addClass('zh-input');
    if (hint) wrap.createSpan({ cls: 'zh-field-hint', text: hint });
  }

  /** Поле, которое сохраняется при уходе из него (или по Enter). */
  private textInput(parent: HTMLElement, value: string, placeholder: string, save: (v: string) => Promise<unknown>): HTMLInputElement {
    const input = parent.createEl('input', { type: 'text', attr: { autocapitalize: 'off', autocomplete: 'off', enterkeyhint: 'done', placeholder } });
    input.value = value;
    let saved = value;
    input.addEventListener('change', async () => {
      const v = input.value.trim();
      if (v === saved) return;
      try {
        await save(v);
        saved = v;
      } catch (err) {
        new Notice(`Не удалось сохранить: ${(err as Error).message}`, 8000);
      }
    });
    input.addEventListener('keydown', (evt) => evt.key === 'Enter' && input.blur());
    return input;
  }

  private async toggleCheck(sel: Done, ei: number) {
    const set = new Set(this.plugin.settings.checks[key(sel)] ?? []);
    if (set.has(ei)) set.delete(ei);
    else set.add(ei);
    if (set.size) this.plugin.settings.checks[key(sel)] = [...set].sort((a, b) => a - b);
    else delete this.plugin.settings.checks[key(sel)];
    await this.plugin.saveSettings();
    this.render();
  }

  private select(d: Done) {
    this.sel = d;
    this.render();
  }

  // =====================================================================
  // Редактор плана

  private iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void, cls = '') {
    const b = parent.createEl('button', { cls: `clickable-icon zh-icon-btn ${cls}`, attr: { 'aria-label': label } });
    setIcon(b, icon);
    b.onclick = onClick;
    return b;
  }

  private edit(fn: (p: Plan) => void, ok?: string) {
    return this.run(() => this.store.edit(fn), ok);
  }

  private renderEditor(el: HTMLElement, plan: Plan) {
    // ---- Микроциклы ----
    const mcBox = el.createDiv('zh-section');
    const mcHead = mcBox.createDiv('zh-section-head');
    mcHead.createDiv({ cls: 'zh-section-title', text: `Микроциклы · ${plan.mcNames.length}` });
    const mcActions = mcHead.createDiv('zh-actions');
    this.iconButton(mcActions, 'minus', 'Убрать последний микроцикл', async () => {
      const n = plan.mcNames.length;
      if (n <= 1) return;
      if (await confirm(this.app, 'Убрать микроцикл', `Удалить МЦ${n} вместе с весами и записями журнала в нём?`)) this.edit((p) => E.removeLastMc(p));
    });
    this.iconButton(mcActions, 'plus', 'Добавить микроцикл', () => this.edit((p) => E.addMc(p)));
    const mcList = mcBox.createDiv('zh-mc-list');
    plan.mcNames.forEach((name, i) => {
      const row = mcList.createDiv('zh-mc-row');
      row.createSpan({ cls: 'zh-mc-num', text: `МЦ${i + 1}` });
      this.textInput(row, name, `Микроцикл ${i + 1}`, (v) => this.store.edit((p) => E.renameMc(p, i, v))).addClass('zh-input');
    });

    // ---- Тренировки ----
    const wBox = el.createDiv('zh-section');
    const wHead = wBox.createDiv('zh-section-head');
    wHead.createDiv({ cls: 'zh-section-title', text: 'Тренировки' });
    this.iconButton(wHead.createDiv('zh-actions'), 'plus', 'Добавить тренировку', async () => {
      const name = await prompt(this.app, 'Новая тренировка', `Тренировка ${plan.workouts.length + 1}: `, 'Тренировка 5: ноги');
      if (name) {
        this.sel = { mc: this.sel?.mc ?? 1, workout: plan.workouts.length + 1 };
        this.edit((p) => E.addWorkout(p, name));
      }
    });
    if (!plan.workouts.length) {
      wBox.createDiv({ cls: 'zh-empty', text: 'Тренировок пока нет — добавьте первую кнопкой «+».' });
      return;
    }
    this.renderSelectors(wBox, plan, [], false);

    const wi = this.sel!.workout - 1;
    const workout = plan.workouts[wi];
    const wCard = wBox.createDiv('zh-workout-head');
    this.textInput(wCard, workout.name, 'Название тренировки', (v) => this.store.edit((p) => E.renameWorkout(p, wi, v))).addClass('zh-input', 'zh-input-title');
    const wActions = wCard.createDiv('zh-actions');
    this.iconButton(wActions, 'arrow-left', 'Переместить раньше', () => {
      if (wi > 0) {
        this.sel = { ...this.sel!, workout: wi };
        this.edit((p) => E.moveWorkout(p, wi, wi - 1));
      }
    });
    this.iconButton(wActions, 'arrow-right', 'Переместить позже', () => {
      if (wi < plan.workouts.length - 1) {
        this.sel = { ...this.sel!, workout: wi + 2 };
        this.edit((p) => E.moveWorkout(p, wi, wi + 1));
      }
    });
    this.iconButton(wActions, 'copy', 'Дублировать', () => {
      this.sel = { ...this.sel!, workout: wi + 2 };
      this.edit((p) => E.duplicateWorkout(p, wi), 'Тренировка скопирована');
    });
    this.iconButton(
      wActions,
      'trash-2',
      'Удалить тренировку',
      async () => {
        if (await confirm(this.app, 'Удалить тренировку', `«${workout.name}» и все её упражнения, веса и записи журнала будут удалены.`)) {
          this.sel = { ...this.sel!, workout: Math.max(1, wi) };
          this.edit((p) => E.deleteWorkout(p, wi));
        }
      },
      'mod-warning'
    );

    // ---- Упражнения ----
    const list = wBox.createDiv('zh-list');
    workout.exercises.forEach((ex, ei) => {
      const card = list.createDiv('zh-card zh-edit-card');
      const top = card.createDiv('zh-edit-top');
      top.createSpan({ cls: 'zh-edit-num', text: `${ei + 1}.` });
      this.textInput(top, ex.name, 'Название', (v) => this.store.edit((p) => E.updateExercise(p, wi, ei, { name: v }))).addClass('zh-input');
      const actions = top.createDiv('zh-actions');
      this.iconButton(actions, 'arrow-up', 'Выше', () => this.edit((p) => E.moveExercise(p, wi, ei, ei - 1)));
      this.iconButton(actions, 'arrow-down', 'Ниже', () => this.edit((p) => E.moveExercise(p, wi, ei, ei + 1)));
      this.iconButton(
        actions,
        'trash-2',
        'Удалить упражнение',
        async () => {
          if (await confirm(this.app, 'Удалить упражнение', `«${ex.name}» вместе с весами по всем микроциклам?`)) this.edit((p) => E.deleteExercise(p, wi, ei));
        },
        'mod-warning'
      );

      const rest = card.createEl('label', { cls: 'zh-field' });
      rest.createSpan({ cls: 'zh-field-label', text: 'Темп / отдых' });
      this.textInput(rest, ex.rest, '3111/до 120 сек', (v) => this.store.edit((p) => E.updateExercise(p, wi, ei, { rest: v }))).addClass('zh-input');

      const spHead = card.createDiv('zh-sp-head');
      spHead.createSpan({ cls: 'zh-field-label', text: 'Подходы × повторения' });
      spHead.createEl('a', { text: 'во всех МЦ одинаково' }).onclick = async () => {
        const v = await prompt(this.app, 'Подходы × повторения во всех МЦ', ex.rows[0]?.sp ?? '', '3×10');
        if (v) this.edit((p) => E.fillSp(p, wi, ei, v));
      };
      const grid = card.createDiv('zh-sp-grid');
      plan.mcNames.forEach((_, i) => {
        const cell = grid.createEl('label', { cls: 'zh-sp-cell' });
        cell.createSpan({ cls: 'zh-sp-mc', text: `МЦ${i + 1}` });
        const r = ex.rows.find((x) => x.mc === i + 1);
        this.textInput(cell, r?.sp ?? '', '—', (v) => this.store.edit((p) => E.setSp(p, wi, ei, i + 1, v))).addClass('zh-input');
      });
    });

    const add = wBox.createEl('button', { cls: 'zh-add', text: '+ Упражнение' });
    add.onclick = async () => {
      const name = await prompt(this.app, 'Новое упражнение', '', 'Жим гантелей сидя');
      if (!name) return;
      const sp = await prompt(this.app, 'Подходы × повторения (во всех МЦ, потом можно поменять)', '', '3×10');
      this.edit((p) => E.addExercise(p, wi, name, sp ?? ''));
    };
  }

  // =====================================================================
  // Журнал

  private renderJournal(el: HTMLElement, plan: Plan, journal: JournalRow[]) {
    const total = plan.mcNames.length * plan.workouts.length;
    const done = journal.filter((j) => j.status === 'done').length;
    const skipped = journal.filter((j) => j.status === 'skipped').length;

    const stats = el.createDiv('zh-stats');
    const stat = (value: string, label: string) => {
      const s = stats.createDiv('zh-stat');
      s.createDiv({ cls: 'zh-stat-value', text: value });
      s.createDiv({ cls: 'zh-stat-label', text: label });
    };
    stat(`${done}`, `из ${total} сделано`);
    stat(`${skipped}`, 'пропущено');
    const last = journal.find((j) => j.status === 'done');
    stat(last ? dayRu(last.date) : '—', 'последняя');

    const add = el.createEl('button', { cls: 'mod-cta zh-add-wide', text: 'Отметить тренировку…' });
    add.onclick = async () => {
      const res = await logModal(this.app, plan, this.store.suggest(plan, journal) ?? this.sel!);
      if (res) await this.run(() => this.store.log(plan, res, res.date, res.status, res.note), 'Сохранено в журнале');
    };

    if (!journal.length) {
      el.createDiv({ cls: 'zh-empty', text: 'Записей пока нет. Тренировка попадает сюда кнопкой «Записать тренировку» или «Отметить тренировку…».' });
      return;
    }
    const inPlan = new Set(plan.journal.map((j) => `${j.date}:${key(j)}`));
    const list = el.createDiv('zh-journal');
    for (const j of journal) {
      const row = list.createDiv('zh-journal-row');
      row.toggleClass('is-skipped', j.status === 'skipped');
      setIcon(row.createSpan('zh-journal-icon'), j.status === 'done' ? 'check' : 'skip-forward');
      const info = row.createDiv('zh-journal-info');
      info.createDiv({ cls: 'zh-journal-title', text: `МЦ${j.mc} · ${plan.workouts[j.workout - 1]?.short ?? '?'}` });
      const sub = [dayRu(j.date), j.status === 'skipped' ? 'пропущена' : '', j.note, inPlan.has(`${j.date}:${key(j)}`) ? '' : 'из дневника'].filter(Boolean);
      info.createDiv({ cls: 'zh-journal-sub', text: sub.join(' · ') });
      const actions = row.createDiv('zh-actions');
      this.iconButton(actions, 'calendar', 'Перенести на другой день', async () => {
        const date = await dateModal(this.app, 'Перенести тренировку', j.date);
        if (date) await this.run(() => this.store.move(plan, j, date), `Перенесено на ${dayRu(date)}`);
      });
      this.iconButton(
        actions,
        'x',
        'Снять отметку',
        async () => {
          if (await confirm(this.app, 'Снять отметку', `Убрать МЦ${j.mc} · ${plan.workouts[j.workout - 1]?.short} (${dayRu(j.date)}) из журнала и из заметки дня?`, 'Убрать'))
            await this.run(() => this.store.unlog(plan, j), 'Отметка снята');
        },
        'mod-warning'
      );
    }
  }

  // =====================================================================
  // Прогресс

  private renderProgress(el: HTMLElement, plan: Plan, journal: JournalRow[]) {
    const all = plan.workouts.flatMap((w, wi) => w.exercises.map((ex, ei) => ({ w, wi, ex, ei, id: `${wi}:${ei}` })));
    if (!all.length) {
      el.createDiv({ cls: 'zh-empty', text: 'В плане пока нет упражнений.' });
      return;
    }

    // Программа целиком.
    const total = plan.mcNames.length * plan.workouts.length;
    const done = journal.filter((j) => j.status === 'done').length;
    const overall = el.createDiv('zh-progress');
    overall.createDiv('zh-progress-bar').createDiv('zh-progress-fill').style.width = `${total ? (done / total) * 100 : 0}%`;
    overall.createDiv({ cls: 'zh-progress-text', text: `${done} из ${total} тренировок` });

    // Выбор упражнения: по умолчанию — первое, где больше всего вписанных весов.
    const numeric = (ex: Exercise) => ex.rows.filter((r) => weightNumber(r.weight) !== null).length;
    if (!this.progressEx || !all.some((a) => a.id === this.progressEx)) {
      this.progressEx = [...all].sort((a, b) => numeric(b.ex) - numeric(a.ex))[0].id;
    }
    const select = el.createEl('select', { cls: 'dropdown zh-select' });
    for (const [wi, w] of plan.workouts.entries()) {
      const group = select.createEl('optgroup', { attr: { label: w.name } });
      w.exercises.forEach((ex, ei) => group.createEl('option', { text: ex.name, value: `${wi}:${ei}` }));
    }
    select.value = this.progressEx;
    select.onchange = () => {
      this.progressEx = select.value;
      this.render();
    };

    const cur = all.find((a) => a.id === this.progressEx)!;
    const points = cur.ex.rows
      .map((r) => ({ mc: r.mc, value: weightNumber(r.weight), raw: r.weight, sp: r.sp }))
      .filter((p): p is { mc: number; value: number; raw: string; sp: string } => p.value !== null);

    // Главная цифра — лучший результат.
    const hero = el.createDiv('zh-hero');
    if (points.length) {
      const best = points.reduce((a, b) => (b.value >= a.value ? b : a));
      hero.createDiv({ cls: 'zh-hero-value', text: best.raw });
      const first = points[0];
      const delta = best.value - first.value;
      hero.createDiv({
        cls: 'zh-hero-label',
        text: `лучший вес · МЦ${best.mc}${points.length > 1 && delta ? ` · ${delta > 0 ? '+' : ''}${Math.round(delta * 10) / 10} с МЦ${first.mc}` : ''}`,
      });
    } else {
      hero.createDiv({ cls: 'zh-hero-label', text: 'Весов пока нет — вписывайте их на вкладке «Тренировка».' });
    }

    if (points.length >= 2) this.renderChart(el, points, plan.mcNames.length);

    // Таблица — та же информация без графика (и для тех, кто хочет точные значения).
    const table = el.createEl('table', { cls: 'zh-table' });
    const head = table.createEl('thead').createEl('tr');
    for (const h of ['МЦ', 'С×П', 'Вес', 'Заметка']) head.createEl('th', { text: h });
    const tbody = table.createEl('tbody');
    for (const r of cur.ex.rows) {
      const tr = tbody.createEl('tr');
      tr.createEl('td', { text: String(r.mc) });
      tr.createEl('td', { text: r.sp });
      tr.createEl('td', { text: r.weight });
      tr.createEl('td', { text: r.note });
    }
  }

  /** Линия веса по микроциклам: одна серия → без легенды, точки с подсказкой при наведении/нажатии. */
  private renderChart(el: HTMLElement, points: { mc: number; value: number; raw: string; sp: string }[], mcCount: number) {
    const W = 340;
    const H = 180;
    const pad = { l: 36, r: 12, t: 12, b: 26 };
    // Шкала с «круглым» шагом (1, 2, 5, 10…), чтобы подписи были ровными.
    const values = points.map((p) => p.value);
    const rawLo = Math.min(...values);
    const rawHi = Math.max(...values);
    const range = Math.max(rawHi - rawLo, 4);
    const mag = 10 ** Math.floor(Math.log10(range / 3));
    const step = [1, 2, 5, 10].map((k) => k * mag).find((st) => range / st <= 4) ?? 10 * mag;
    const lo = Math.max(0, Math.floor((rawLo - step / 2) / step) * step);
    const hi = Math.ceil((rawHi + step / 2) / step) * step;
    const x = (mc: number) => pad.l + ((mc - 1) / Math.max(1, mcCount - 1)) * (W - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);

    const wrap = el.createDiv('zh-chart');
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Вес по микроциклам: ${points.map((p) => `МЦ${p.mc} ${p.raw}`).join(', ')}`);
    wrap.appendChild(svg);
    const add = (tag: string, attrs: Record<string, string | number>, cls?: string) => {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      if (cls) n.setAttribute('class', cls);
      svg.appendChild(n);
      return n;
    };

    // Сетка и оси — приглушённые.
    for (let v = lo; v <= hi + 1e-9; v += step) {
      add('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }, 'zh-grid');
      add('text', { x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, 'zh-axis').textContent = String(Math.round(v * 10) / 10);
    }
    for (let mc = 1; mc <= mcCount; mc++) add('text', { x: x(mc), y: H - 8, 'text-anchor': 'middle' }, 'zh-axis').textContent = String(mc);

    add('path', { d: points.map((p, i) => `${i ? 'L' : 'M'}${x(p.mc)},${y(p.value)}`).join(' '), fill: 'none' }, 'zh-line');

    const tip = wrap.createDiv('zh-tip');
    const show = (p: (typeof points)[number]) => {
      tip.setText(`МЦ${p.mc}: ${p.raw}${p.sp ? ` · ${p.sp}` : ''}`);
      tip.style.left = `${(x(p.mc) / W) * 100}%`;
      tip.style.top = `${(y(p.value) / H) * 100}%`;
      tip.addClass('is-visible');
    };
    for (const p of points) {
      add('circle', { cx: x(p.mc), cy: y(p.value), r: 4.5 }, 'zh-dot');
      // Цель для пальца больше самой точки.
      const hit = add('circle', { cx: x(p.mc), cy: y(p.value), r: 16, fill: 'transparent' }, 'zh-hit');
      hit.addEventListener('mouseenter', () => show(p));
      hit.addEventListener('click', () => show(p));
      hit.addEventListener('mouseleave', () => tip.removeClass('is-visible'));
    }
    // Подпись последней точки — без числа на каждой.
    const lastP = points[points.length - 1];
    add('text', { x: x(lastP.mc), y: y(lastP.value) - 10, 'text-anchor': lastP.mc === mcCount ? 'end' : 'middle' }, 'zh-label').textContent = lastP.raw;
  }

  // =====================================================================
  // Нет плана

  private renderSetup(el: HTMLElement, state: PlanState) {
    const box = el.createDiv('zh-setup');
    if (state.kind === 'legacy') {
      box.createEl('h3', { text: 'План в старом формате' });
      box.createEl('p', {
        text: `«${state.file.basename}» хранит план в блоке dataviewjs и JSON-файле. Железо переведёт его в обычные таблицы markdown прямо в этой заметке: все вписанные веса и заметки сохранятся, остальной текст не изменится, JSON-файл останется на месте.`,
      });
      const btn = box.createEl('button', { cls: 'mod-cta', text: 'Перевести в markdown' });
      btn.onclick = () => {
        btn.disabled = true;
        this.run(() => this.store.migrate(state.file), 'План переведён в markdown');
      };
      return;
    }

    box.createEl('h3', { text: 'Выберите план' });
    if (state.kind === 'missing') box.createEl('p', { text: `Заметка «${state.path}» не найдена.` });
    if (state.kind === 'empty') box.createEl('p', { text: `В «${state.file.basename}» нет плана. Создайте новый или выберите другую заметку.` });

    box.createEl('button', { cls: 'mod-cta', text: 'Создать новый план' }).onclick = () => this.createPlan();
    const active = this.app.workspace.getActiveFile();
    if (active && active.extension === 'md' && active.path !== this.plugin.settings.planPath) {
      box.createEl('button', { text: `Использовать «${active.basename}»` }).onclick = () => this.plugin.usePlan(active);
    }
    // Свои планы и заметки старого формата (рядом лежит «…-data.json»).
    const known = this.store.plans().map((p) => p.file);
    const legacy = this.app.vault.getMarkdownFiles().filter((f) => this.app.vault.getAbstractFileByPath(this.store.legacyDataPath(f)));
    for (const f of [...new Set([...known, ...legacy])].slice(0, 8)) {
      if (f.path === this.plugin.settings.planPath) continue;
      box.createEl('button', { cls: 'zh-candidate', text: f.path }).onclick = () => this.plugin.usePlan(f);
    }
  }
}
