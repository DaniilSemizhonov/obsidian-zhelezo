// Строки тренировок в ежедневных заметках и выбор следующей тренировки. Чистые функции.
import { JournalRow, workoutIndex } from './plan';

export interface Done {
  mc: number;
  workout: number; // с 1
}

const MARK = '🏋️';
const ENTRY_RE = /🏋️\s*МЦ\s*(\d+)\s*·\s*([^·\n]+)/;

/** «🏋️ МЦ3 · Тренировка 2: общая, акцент квадры · [[План|план]]» */
export function entryLine(mc: number, workoutName: string, planLink: string): string {
  return `${MARK} МЦ${mc} · ${workoutName} · ${planLink}`;
}

function entryOf(line: string, names: string[]): Done | null {
  const m = ENTRY_RE.exec(line);
  if (!m) return null;
  const i = workoutIndex(names, m[2]);
  return i >= 0 ? { mc: +m[1], workout: i + 1 } : null;
}

/** Все тренировки, записанные в тексте ежедневной заметки. */
export function parseEntries(text: string, names: string[]): Done[] {
  return text
    .split('\n')
    .map((l) => entryOf(l, names))
    .filter((d): d is Done => !!d);
}

const same = (a: Done, b: Done) => a.mc === b.mc && a.workout === b.workout;

/**
 * Добавляет строку тренировки в ежедневную заметку: отмечает привычку и кладёт строку
 * вложенным пунктом под неё. Нет привычки — дописывает в конец. Дубли не добавляет.
 */
export function addEntry(text: string, line: string, done: Done, names: string[], habit: RegExp | null): { text: string; added: boolean } {
  if (parseEntries(text, names).some((d) => same(d, done))) return { text, added: false };

  const lines = text.split('\n');
  if (habit) {
    const idx = lines.findIndex((l) => /^\s*[-*+] \[.\]/.test(l) && habit.test(l));
    if (idx >= 0) {
      lines[idx] = lines[idx].replace(/\[.\]/, '[x]');
      const indent = /^(\s*)/.exec(lines[idx])![1];
      let at = idx + 1;
      while (at < lines.length && lines[at].startsWith(indent) && /^\s+\S/.test(lines[at].slice(indent.length))) at++;
      lines.splice(at, 0, `${indent}\t- ${line}`);
      return { text: lines.join('\n'), added: true };
    }
  }
  const trimmed = text.replace(/\s+$/, '');
  return { text: `${trimmed}${trimmed ? '\n\n' : ''}- ${line}\n`, added: true };
}

/** Убирает строку тренировки из ежедневной заметки. Галочку привычки не трогает — там могла быть и другая активность. */
export function removeEntry(text: string, done: Done, names: string[]): { text: string; removed: boolean } {
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => {
    const d = entryOf(l, names);
    return !!d && same(d, done);
  });
  if (idx < 0) return { text, removed: false };
  lines.splice(idx, 1);
  return { text: lines.join('\n'), removed: true };
}

/** Позиция тренировки в программе: МЦ1 Т1, МЦ1 Т2, …, МЦ2 Т1, … */
const pos = (d: Done, workoutCount: number) => (d.mc - 1) * workoutCount + (d.workout - 1);
const fromPos = (p: number, workoutCount: number): Done => ({ mc: Math.floor(p / workoutCount) + 1, workout: (p % workoutCount) + 1 });

/**
 * Следующая тренировка — первая по программе, которой ещё нет в журнале (ни сделанной, ни пропущенной),
 * начиная с самой ранней записи журнала. Так работают и пропуски, и тренировки не по порядку,
 * а то, что было сделано до появления журнала, не мешает.
 * Если журнал пуст — после последней тренировки, где уже вписан вес.
 */
export function nextWorkout(journal: JournalRow[], lastWithWeights: Done | null, mcCount: number, workoutCount: number): Done | null {
  const total = mcCount * workoutCount;
  if (!total) return null;
  if (!journal.length) {
    if (!lastWithWeights) return { mc: 1, workout: 1 };
    const p = pos(lastWithWeights, workoutCount) + 1;
    return p < total ? fromPos(p, workoutCount) : null;
  }
  const taken = new Set(journal.map((j) => pos(j, workoutCount)));
  const start = Math.min(...taken);
  for (let p = start; p < total; p++) if (!taken.has(p)) return fromPos(p, workoutCount);
  return null; // программа пройдена
}
