import { Notice, Plugin, TFile } from 'obsidian';
import { DEFAULT_SETTINGS, WorkoutSettings, WorkoutSettingTab } from './settings';
import { PlanStore } from './store';
import { VIEW_TYPE, WorkoutView } from './view';

export default class WorkoutPlugin extends Plugin {
  settings!: WorkoutSettings;
  store!: PlanStore;

  async onload() {
    await this.loadSettings();
    this.store = new PlanStore(this.app, this);
    this.registerView(VIEW_TYPE, (leaf) => new WorkoutView(leaf, this));

    this.addRibbonIcon('dumbbell', 'Железо', () => this.openView());
    this.addCommand({ id: 'open', name: 'Открыть Железо', callback: () => this.openView() });
    this.addCommand({
      id: 'use-active-note',
      name: 'Сделать открытую заметку планом тренировок',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) this.usePlan(file);
        return true;
      },
    });
    this.addSettingTab(new WorkoutSettingTab(this.app, this));
  }

  async openView() {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (existing) {
      await workspace.revealLeaf(existing);
      return;
    }
    // Отдельная вкладка: на телефоне она занимает весь экран.
    const leaf = workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await workspace.revealLeaf(leaf);
  }

  async usePlan(file: TFile) {
    await this.store.use(file);
    new Notice(`План тренировок: «${file.basename}»`);
    this.refreshViews();
    await this.openView();
  }

  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof WorkoutView) leaf.view.requestRender();
    }
  }

  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
