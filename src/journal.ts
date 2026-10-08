// Запись тренировки в ежедневную заметку и разбор истории. Чистые функции.

export interface Done {
  mc: number;
  workout: number; // с 1, как в «Тренировка 2»
}

const MARK = '🏋️';
const ENTRY_RE = /🏋️\s*МЦ\s*(\d+)\s*·\s*([^·\n]+)/g;

/** «🏋️ МЦ3 · Тренировка 2: общая, акцент квадры · [[План|план]]» */
export function entryLine(mc: number, workoutName: string, planLink: string): string {
  return `${MARK} МЦ${mc} · ${workoutName} · ${planLink}`;
}

/**
 * Все тренировки, записанные в тексте заметки. Тренировку узнаём по названию из плана
 * (полному или короткому, «Тренировка 2»), а не по цифрам — названия бывают и без номеров.
 */
export function parseEntries(text: string, workoutNames: string[]): Done[] {
  const out: Done[] = [];
  for (const m of text.matchAll(ENTRY_RE)) {
    const rest = m[2].trim();
    // Сначала самые длинные названия, чтобы «Тренировка 1» не съела «Тренировка 10».
    // Полное имя или короткое («Тренировка 2») — короткое переживёт правку описания тренировки.
    const idx = workoutNames
      .flatMap((name, i) => [{ name, i }, { name: name.split(':')[0].trim(), i }])
      .sort((a, b) => b.name.length - a.name.length)
      .find(({ name }) => rest === name || rest.startsWith(`${name}:`) || rest.startsWith(`${name} `))?.i;
    if (idx !== undefined) out.push({ mc: +m[1], workout: idx + 1 });
  }
  return out;
}

/**
 * Добавляет строку тренировки в ежедневную заметку:
 * отмечает привычку (например «🏃 Физическая активность») и кладёт строку вложенным пунктом под неё.
 * Если привычки нет — дописывает строку в конец. Повторно ту же тренировку не добавляет.
 */
export function addEntry(
  text: string,
  line: string,
  done: Done,
  workoutNames: string[],
  habit: RegExp | null
): { text: string; added: boolean } {
  if (parseEntries(text, workoutNames).some((d) => d.mc === done.mc && d.workout === done.workout)) return { text, added: false };

  const lines = text.split('\n');
  if (habit) {
    const idx = lines.findIndex((l) => /^\s*[-*+] \[.\]/.test(l) && habit.test(l));
    if (idx >= 0) {
      lines[idx] = lines[idx].replace(/\[.\]/, '[x]');
      const indent = /^(\s*)/.exec(lines[idx])![1];
      // Вставляем после уже вложенных пунктов этой привычки.
      let at = idx + 1;
      while (at < lines.length && lines[at].startsWith(indent) && /^\s+\S/.test(lines[at].slice(indent.length))) at++;
      lines.splice(at, 0, `${indent}\t- ${line}`);
      return { text: lines.join('\n'), added: true };
    }
  }
  const trimmed = text.replace(/\s+$/, '');
  return { text: `${trimmed}${trimmed ? '\n\n' : ''}- ${line}\n`, added: true };
}

export interface HistoryItem extends Done {
  date: string; // YYYY-MM-DD
  path: string;
}

/**
 * Какую тренировку делать дальше: следующая после последней записанной,
 * а если записей нет — после последней, где уже вписан вес.
 */
export function nextWorkout(history: HistoryItem[], lastWithWeights: Done | null, mcCount: number, workoutCount: number): Done {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date) || a.mc - b.mc || a.workout - b.workout);
  const last = sorted[sorted.length - 1] ?? lastWithWeights;
  if (!last) return { mc: 1, workout: 1 };
  if (last.workout < workoutCount) return { mc: last.mc, workout: last.workout + 1 };
  return { mc: Math.min(last.mc + 1, mcCount), workout: 1 };
}
