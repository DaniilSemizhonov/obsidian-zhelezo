import { App, Modal, Setting, TFile } from 'obsidian';
import type { Done } from './journal';
import type { Plan, Status } from './plan';
import { todayIso } from './store';

/** Подтверждение для разрушительных действий. */
export function confirm(app: App, title: string, text: string, cta = 'Удалить'): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const m = new Modal(app);
    m.titleEl.setText(title);
    m.contentEl.createEl('p', { text });
    new Setting(m.contentEl)
      .addButton((b) =>
        b
          .setButtonText(cta)
          .setWarning()
          .onClick(() => {
            answered = true;
            resolve(true);
            m.close();
          })
      )
      .addButton((b) => b.setButtonText('Отмена').onClick(() => m.close()));
    m.onClose = () => !answered && resolve(false);
    m.open();
  });
}

/** Ввод одной строки (название тренировки, упражнения, микроцикла). */
export function prompt(app: App, title: string, value = '', placeholder = ''): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const m = new Modal(app);
    m.titleEl.setText(title);
    const input = m.contentEl.createEl('input', { type: 'text', cls: 'zh-modal-input', attr: { placeholder } });
    input.value = value;
    const submit = () => {
      result = input.value.trim() || null;
      m.close();
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
    new Setting(m.contentEl).addButton((b) => b.setButtonText('Готово').setCta().onClick(submit));
    m.onClose = () => resolve(result);
    m.open();
    window.setTimeout(() => input.focus(), 50);
  });
}

export interface NewPlanResult {
  title: string;
  folder: string;
  mcCount: number;
  copyFrom: TFile | null;
}

export function newPlanModal(app: App, plans: TFile[], defaultFolder: string): Promise<NewPlanResult | null> {
  return new Promise((resolve) => {
    let result: NewPlanResult | null = null;
    const state: NewPlanResult = { title: '', folder: defaultFolder, mcCount: 8, copyFrom: null };
    const m = new Modal(app);
    m.titleEl.setText('Новый план');
    new Setting(m.contentEl).setName('Название').addText((t) => t.setPlaceholder('Силовой, осень 2026').onChange((v) => (state.title = v)));
    new Setting(m.contentEl).setName('Папка').addText((t) => t.setValue(defaultFolder).onChange((v) => (state.folder = v.trim().replace(/\/$/, ''))));
    const mc = new Setting(m.contentEl).setName('Микроциклов').addText((t) => {
      t.inputEl.type = 'number';
      t.inputEl.min = '1';
      t.setValue('8').onChange((v) => (state.mcCount = Math.max(1, Math.min(52, parseInt(v, 10) || 1))));
    });
    new Setting(m.contentEl)
      .setName('Основа')
      .setDesc('Можно взять тренировки и подходы из другого плана — без весов и журнала.')
      .addDropdown((d) => {
        d.addOption('', 'Пустой план');
        for (const f of plans) d.addOption(f.path, `Копия: ${f.basename}`);
        d.onChange((v) => {
          state.copyFrom = plans.find((f) => f.path === v) ?? null;
          mc.settingEl.toggle(!state.copyFrom);
        });
      });
    new Setting(m.contentEl).addButton((b) =>
      b
        .setButtonText('Создать')
        .setCta()
        .onClick(() => {
          if (!state.title.trim()) return;
          result = { ...state, title: state.title.trim() };
          m.close();
        })
    );
    m.onClose = () => resolve(result);
    m.open();
  });
}

export interface LogResult extends Done {
  date: string;
  status: Status;
  note: string;
}

/** Отметить тренировку на любую дату (задним числом), как сделанную или пропущенную. */
export function logModal(app: App, plan: Plan, initial: Done, title = 'Отметить тренировку'): Promise<LogResult | null> {
  return new Promise((resolve) => {
    let result: LogResult | null = null;
    const state: LogResult = { ...initial, date: todayIso(), status: 'done', note: '' };
    const m = new Modal(app);
    m.titleEl.setText(title);
    new Setting(m.contentEl).setName('Дата').addText((t) => {
      t.inputEl.type = 'date';
      t.setValue(state.date).onChange((v) => (state.date = v));
    });
    new Setting(m.contentEl).setName('Микроцикл').addDropdown((d) => {
      plan.mcNames.forEach((n, i) => d.addOption(String(i + 1), `МЦ${i + 1} · ${n}`));
      d.setValue(String(state.mc)).onChange((v) => (state.mc = +v));
    });
    new Setting(m.contentEl).setName('Тренировка').addDropdown((d) => {
      plan.workouts.forEach((w, i) => d.addOption(String(i + 1), w.name));
      d.setValue(String(state.workout)).onChange((v) => (state.workout = +v));
    });
    new Setting(m.contentEl).setName('Статус').addDropdown((d) =>
      d
        .addOption('done', 'Сделана')
        .addOption('skipped', 'Пропущена')
        .setValue(state.status)
        .onChange((v) => (state.status = v as Status))
    );
    new Setting(m.contentEl).setName('Заметка').addText((t) => t.onChange((v) => (state.note = v)));
    new Setting(m.contentEl).addButton((b) =>
      b
        .setButtonText('Сохранить')
        .setCta()
        .onClick(() => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(state.date)) return;
          result = state;
          m.close();
        })
    );
    m.onClose = () => resolve(result);
    m.open();
  });
}

/** Новая дата для записи журнала. */
export function dateModal(app: App, title: string, value: string): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const m = new Modal(app);
    m.titleEl.setText(title);
    let date = value;
    new Setting(m.contentEl).setName('Дата').addText((t) => {
      t.inputEl.type = 'date';
      t.setValue(value).onChange((v) => (date = v));
    });
    new Setting(m.contentEl).addButton((b) =>
      b
        .setButtonText('Перенести')
        .setCta()
        .onClick(() => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
          result = date;
          m.close();
        })
    );
    m.onClose = () => resolve(result);
    m.open();
  });
}
