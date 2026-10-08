import { AbstractInputSuggest, App, PluginSettingTab, Setting, TFile } from 'obsidian';
import type WorkoutPlugin from './main';

export interface WorkoutSettings {
  planPath: string;
  /** Какую привычку в ежедневной заметке отмечать (регулярное выражение, без учёта регистра). */
  habitPattern: string;
  /** Отмеченные упражнения незавершённых тренировок: «мц:тренировка» → индексы упражнений. */
  checks: Record<string, number[]>;
}

export const DEFAULT_SETTINGS: WorkoutSettings = {
  planPath: '',
  habitPattern: 'физическ|спорт',
  checks: {},
};

class NoteSuggest extends AbstractInputSuggest<TFile> {
  constructor(app: App, private input: HTMLInputElement, private onPick: (f: TFile) => void) {
    super(app, input);
  }
  getSuggestions(query: string): TFile[] {
    const q = query.toLowerCase();
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.toLowerCase().includes(q))
      .slice(0, 30);
  }
  renderSuggestion(file: TFile, el: HTMLElement) {
    el.setText(file.path);
  }
  selectSuggestion(file: TFile) {
    this.input.value = file.path;
    this.onPick(file);
    this.close();
  }
}

export class WorkoutSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: WorkoutPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    const { settings } = this.plugin;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Заметка с планом')
      .setDesc('Заметка, в которой хранится план и веса. Её же можно выбрать командой «Сделать открытую заметку планом».')
      .addText((t) => {
        t.setPlaceholder('Здоровье/Тренировочный план.md').setValue(settings.planPath);
        const save = async (path: string) => {
          settings.planPath = path.trim();
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        };
        t.onChange(save);
        new NoteSuggest(this.app, t.inputEl, (f) => save(f.path));
      });

    new Setting(containerEl)
      .setName('Привычка в ежедневной заметке')
      .setDesc(
        'Галочку у этой привычки плагин ставит сам, а строку тренировки кладёт под неё. Регулярное выражение, регистр не важен. Пусто — строка просто дописывается в конец заметки.'
      )
      .addText((t) =>
        t
          .setPlaceholder('физическ|спорт')
          .setValue(settings.habitPattern)
          .onChange(async (v) => {
            settings.habitPattern = v;
            await this.plugin.saveSettings();
          })
      );
  }
}
