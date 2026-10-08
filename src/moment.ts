// В типах Obsidian moment объявлен как `import * as Moment`, а свежий TypeScript
// не считает такой namespace вызываемым. Тот же объект с правильным типом.
import { moment as obsidianMoment } from 'obsidian';
import type momentFn from 'moment';

export const moment = obsidianMoment as unknown as typeof momentFn;
export type Moment = momentFn.Moment;
