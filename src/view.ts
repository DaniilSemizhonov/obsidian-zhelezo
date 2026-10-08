import { ItemView, Notice, setIcon, TFile, WorkspaceLeaf } from 'obsidian';
import type { Done, HistoryItem } from './journal';
import type WorkoutPlugin from './main';
import { moment } from './moment';
import type { Exercise, Field, Plan } from './plan';

export const VIEW_TYPE = 'workout-panel';

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const dayRu = (iso: string) => {
  const m = moment(iso, 'YYYY-MM-DD');
  const diff = moment().startOf('day').diff(m, 'days');
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'вчера';
  return `${m.date()} ${MONTHS_GEN[m.month()]}`;
};

/** Короткая подпись тренировки для кнопки: «Тренировка 2» → «Т2», иначе первое слово. */
const chipLabel = (short: string) => {
  const m = /(\d+)\s*$/.exec(short);
  return m ? `Т${m[1]}` : short.split(/\s+/)[0];
};

/** Панель тренировки: крупно, по карточке на упражнение — чтобы было удобно с телефона в зале. */
export class WorkoutView extends ItemView {
  private sel: Done | null = null;
  private pendingRender = false;
  private renderId = 0;

  constructor(leaf: WorkspaceLeaf, private plugin: WorkoutPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return 'Тренировка';
  }
  getIcon() {
    return 'dumbbell';
  }

  async onOpen() {
    this.contentEl.addClass('wp-view');
    // План или дневник поменялись (в том числе с другого устройства) — перерисовать.
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (file.path === this.plugin.settings.planPath || this.app.metadataCache.resolvedLinks[file.path]?.[this.plugin.settings.planPath]) {
          this.requestRender();
        }
      })
    );
    this.registerEvent(this.app.vault.on('rename', () => this.requestRender()));
    // Перерисовка, пока набираешь вес, сбросила бы клавиатуру — откладываем до ухода из поля.
    this.registerDomEvent(this.contentEl, 'focusout', () => {
      if (this.pendingRender) window.setTimeout(() => this.requestRender(), 0);
    });
    await this.render();
  }

  requestRender() {
    if (this.contentEl.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement) {
      this.pendingRender = true;
      return;
    }
    this.pendingRender = false;
    this.render();
  }

  private checksKey(d: Done) {
    return `${d.mc}:${d.workout}`;
  }

  async render() {
    // Перерисовки асинхронные и могут пересечься (сохранение веса + синхронизация) —
    // рисует только последняя, и очищаем панель только после всех чтений.
    const id = ++this.renderId;
    const el = this.contentEl;
    const state = await this.plugin.store.state();
    const history = state.kind === 'ok' ? await this.plugin.store.history(state.plan) : [];
    if (id !== this.renderId) return;
    el.empty();

    if (state.kind !== 'ok') return this.renderSetup(el, state);
    const { plan, file } = state;

    const suggestion = this.plugin.store.suggest(plan, history);
    if (!this.sel || this.sel.mc > plan.mcNames.length || this.sel.workout > plan.workouts.length) this.sel = suggestion;
    const sel = this.sel;
    const workout = plan.workouts[sel.workout - 1];

    // ---- Шапка ----
    const head = el.createDiv('wp-head');
    const title = head.createDiv('wp-title');
    title.createSpan({ text: `МЦ${sel.mc} · ${workout.short}` });
    if (sel.mc === suggestion.mc && sel.workout === suggestion.workout) title.createSpan({ cls: 'wp-badge', text: 'по плану' });
    head.createDiv({ cls: 'wp-subtitle', text: plan.mcNames[sel.mc - 1] ?? '' });
    const desc = workout.name.slice(workout.short.length).replace(/^\s*:\s*/, '');
    if (desc) head.createDiv({ cls: 'wp-subtitle', text: desc });

    const doneSet = new Set(history.map((h) => this.checksKey(h)));

    // ---- Выбор микроцикла и тренировки ----
    const mcRow = el.createDiv('wp-chips');
    plan.mcNames.forEach((name, i) => {
      const mc = i + 1;
      const allDone = plan.workouts.every((_, wi) => doneSet.has(`${mc}:${wi + 1}`));
      const chip = mcRow.createEl('button', { cls: 'wp-chip', text: `МЦ${mc}`, attr: { 'aria-label': name } });
      chip.toggleClass('is-active', mc === sel.mc);
      chip.toggleClass('is-done', allDone);
      chip.onclick = () => this.select({ mc, workout: sel.workout });
    });
    const wRow = el.createDiv('wp-chips');
    plan.workouts.forEach((w, i) => {
      const chip = wRow.createEl('button', { cls: 'wp-chip', text: chipLabel(w.short), attr: { 'aria-label': w.name } });
      chip.toggleClass('is-active', i + 1 === sel.workout);
      chip.toggleClass('is-done', doneSet.has(`${sel.mc}:${i + 1}`));
      chip.onclick = () => this.select({ mc: sel.mc, workout: i + 1 });
    });

    // ---- Прогресс ----
    const checks = new Set(this.plugin.settings.checks[this.checksKey(sel)] ?? []);
    const total = workout.exercises.length;
    const progress = el.createDiv('wp-progress');
    const bar = progress.createDiv('wp-progress-bar');
    bar.createDiv('wp-progress-fill').style.width = `${total ? (checks.size / total) * 100 : 0}%`;
    progress.createDiv({ cls: 'wp-progress-text', text: `${checks.size} из ${total}` });

    if (doneSet.has(this.checksKey(sel))) {
      const last = history.find((h) => h.mc === sel.mc && h.workout === sel.workout)!;
      el.createDiv({ cls: 'wp-note', text: `Уже записана: ${dayRu(last.date)}` });
    }

    // ---- Упражнения ----
    const list = el.createDiv('wp-list');
    workout.exercises.forEach((ex, ei) => this.renderExercise(list, plan, ex, ei, sel, checks));

    // ---- Записать в дневник ----
    const footer = el.createDiv('wp-footer');
    const btn = footer.createEl('button', { cls: 'mod-cta wp-finish', text: 'Записать тренировку в дневник' });
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const { file: daily, added } = await this.plugin.store.logToday(plan, sel);
        delete this.plugin.settings.checks[this.checksKey(sel)];
        await this.plugin.saveSettings();
        new Notice(added ? `Тренировка записана в «${daily.basename}» 💪` : `Эта тренировка уже есть в «${daily.basename}»`);
        this.sel = null; // перейти к следующей по плану
      } catch (e) {
        console.error('[workout-panel]', e);
        new Notice(`Не удалось записать тренировку: ${(e as Error).message}`, 8000);
      }
      btn.disabled = false;
      this.render();
    };

    // ---- История ----
    if (history.length) {
      const hist = el.createDiv('wp-history');
      hist.createDiv({ cls: 'wp-section-title', text: 'Последние тренировки' });
      for (const h of history.slice(0, 6)) {
        const row = hist.createDiv('wp-history-row');
        row.createSpan({ cls: 'wp-history-date', text: dayRu(h.date) });
        row.createSpan({ text: `МЦ${h.mc} · ${plan.workouts[h.workout - 1]?.short ?? ''}` });
        row.onclick = () => {
          const f = this.app.vault.getAbstractFileByPath(h.path);
          if (f instanceof TFile) this.app.workspace.getLeaf(false).openFile(f);
        };
      }
    }

    const open = el.createDiv('wp-open-plan');
    open.createEl('a', { text: `Открыть заметку «${file.basename}»` }).onclick = () => this.app.workspace.getLeaf(false).openFile(file);
  }

  private renderExercise(list: HTMLElement, plan: Plan, ex: Exercise, ei: number, sel: Done, checks: Set<number>) {
    const row = ex.rows.find((r) => r.mc === sel.mc);
    const card = list.createDiv('wp-card');
    const isDone = checks.has(ei);
    card.toggleClass('is-done', isDone);

    const top = card.createDiv('wp-card-top');
    const check = top.createEl('button', { cls: 'wp-check', attr: { 'aria-label': isDone ? 'Снять отметку' : 'Сделано' } });
    setIcon(check, isDone ? 'check-circle-2' : 'circle');
    check.onclick = () => this.toggleCheck(sel, ei);

    const info = top.createDiv('wp-card-info');
    info.createDiv({ cls: 'wp-card-name', text: `${ex.order ? `${ex.order}. ` : ''}${ex.name}` });
    const meta = [row?.sp, ex.rest].filter(Boolean).join(' · ');
    if (meta) info.createDiv({ cls: 'wp-card-meta', text: meta });

    if (!row) {
      card.createDiv({ cls: 'wp-card-meta', text: 'В этом микроцикле упражнения нет' });
      return;
    }

    // Вес из прошлого микроцикла — ориентир для прогрессии.
    const prev = [...ex.rows].reverse().find((r) => r.mc < sel.mc && r.weight && !/^ИВН/i.test(r.weight));
    const fields = card.createDiv('wp-fields');
    this.renderInput(fields, 'Вес', row.weight, prev ? `было в МЦ${prev.mc}: ${prev.weight}` : '', sel, sel.workout - 1, ei, 'weight');
    this.renderInput(fields, 'Заметка', row.note, '', sel, sel.workout - 1, ei, 'note');
  }

  private renderInput(parent: HTMLElement, label: string, value: string, hint: string, sel: Done, w: number, e: number, field: Field) {
    const wrap = parent.createEl('label', { cls: `wp-field wp-field-${field}` });
    wrap.createSpan({ cls: 'wp-field-label', text: label });
    const input = wrap.createEl('input', {
      type: 'text',
      attr: { autocapitalize: 'off', autocomplete: 'off', enterkeyhint: 'done', placeholder: field === 'weight' ? '—' : '' },
    });
    input.value = value;
    if (hint) wrap.createSpan({ cls: 'wp-field-hint', text: hint });

    let saved = value;
    const save = async () => {
      const v = input.value.trim();
      if (v === saved) return;
      try {
        await this.plugin.store.setCell(w, e, sel.mc, field, v);
        saved = v;
      } catch (err) {
        new Notice(`Не удалось сохранить: ${(err as Error).message}`, 8000);
      }
    };
    input.addEventListener('change', save);
    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') input.blur();
    });
  }

  private async toggleCheck(sel: Done, ei: number) {
    const key = this.checksKey(sel);
    const set = new Set(this.plugin.settings.checks[key] ?? []);
    if (set.has(ei)) set.delete(ei);
    else set.add(ei);
    if (set.size) this.plugin.settings.checks[key] = [...set].sort((a, b) => a - b);
    else delete this.plugin.settings.checks[key];
    await this.plugin.saveSettings();
    this.render();
  }

  private select(d: Done) {
    this.sel = d;
    this.render();
  }

  private renderSetup(el: HTMLElement, state: Awaited<ReturnType<WorkoutPlugin['store']['state']>>) {
    const box = el.createDiv('wp-setup');
    const active = this.app.workspace.getActiveFile();

    if (state.kind === 'legacy') {
      box.createEl('h3', { text: 'План в старом формате' });
      box.createEl('p', {
        text: `«${state.file.basename}» хранит план в блоке dataviewjs и JSON-файле. Плагин переведёт его в обычные таблицы markdown прямо в этой заметке: все вписанные веса и заметки сохранятся, остальной текст не изменится, JSON-файл останется на месте.`,
      });
      const btn = box.createEl('button', { cls: 'mod-cta', text: 'Перевести в markdown' });
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          await this.plugin.store.migrate(state.file);
          new Notice('План переведён в markdown');
        } catch (e) {
          new Notice(`Не удалось перевести план: ${(e as Error).message}`, 8000);
        }
        this.render();
      };
      return;
    }

    box.createEl('h3', { text: 'Выберите заметку с планом' });
    if (state.kind === 'missing') box.createEl('p', { text: `Заметка «${state.path}» не найдена.` });
    if (state.kind === 'empty') {
      box.createEl('p', {
        text: `В «${state.file.basename}» не нашлось тренировок. Нужны разделы «## Тренировка …», в них «### Упражнение» и таблица | МЦ | С×П | Вес | Заметка |.`,
      });
    }
    if (active && active.extension === 'md') {
      const btn = box.createEl('button', { cls: 'mod-cta', text: `Использовать «${active.basename}»` });
      btn.onclick = () => this.plugin.usePlan(active);
    }
    // Заметки старого формата узнаём по соседнему «…-data.json».
    const candidates = this.app.vault
      .getMarkdownFiles()
      .filter((f) => this.app.vault.getAbstractFileByPath(this.plugin.store.legacyDataPath(f)))
      .slice(0, 5);
    for (const f of candidates) {
      const b = box.createEl('button', { cls: 'wp-candidate', text: f.path });
      b.onclick = () => this.plugin.usePlan(f);
    }
    box.createEl('p', { cls: 'wp-muted', text: 'Заметку можно выбрать и в настройках плагина.' });
  }
}
