// Заметка с планом тренировок в markdown: разбор и обратная сборка. Чистые функции без Obsidian API.
//
// ## Микроциклы
// 1. Микроцикл 1 (втягивающий)
//
// ## Тренировка 1: общая, акцент спина
// ### 2. Вертикальная тяга блока
// Темп/отдых: 3111/до 180 сек
// | МЦ | С×П | Вес | Заметка |
// |----|-----|-----|---------|
// | 1  | 2×10 | 46 |         |
//
// ## Журнал
// | Дата | МЦ | Тренировка | Статус | Заметка |
// |------|----|------------|--------|---------|
// | 2026-10-08 | 3 | Тренировка 2 | ✅ | |
//
// Плагин пересобирает только «свою» часть заметки — от «## Микроциклы» до конца последнего
// своего раздела. Текст до и после, а также посторонние строки внутри разделов сохраняются.

export interface PlanRow {
  mc: number; // с 1
  sp: string;
  weight: string;
  note: string;
  line: number;
}

export interface Exercise {
  order: string;
  name: string;
  rest: string;
  /** Посторонние строки внутри упражнения (пометки пользователя) — переносятся как есть. */
  extra: string[];
  rows: PlanRow[];
  line: number;
}

export interface Workout {
  name: string;
  /** Короткое имя: «Тренировка 1». */
  short: string;
  /** Текст между заголовком тренировки и первым упражнением. */
  intro: string[];
  exercises: Exercise[];
  line: number;
}

export type Status = 'done' | 'skipped';

export interface JournalRow {
  date: string; // YYYY-MM-DD
  mc: number;
  /** Номер тренировки с 1 (определяется по названию). */
  workout: number;
  status: Status;
  note: string;
}

/** Раздел внутри «своей» части заметки, который плагин не понимает, — переносится как есть. */
interface TextSection {
  kind: 'text';
  lines: string[];
}

type Section = { kind: 'mc' } | { kind: 'workout'; workout: Workout } | { kind: 'journal' } | TextSection;

export interface Plan {
  mcNames: string[];
  workouts: Workout[];
  journal: JournalRow[];
  /** Есть ли в заметке раздел «Журнал». */
  hasJournal: boolean;
  /** Порядок разделов «своей» части и её границы в строках (end — не включительно). */
  sections: Section[];
  region: { start: number; end: number } | null;
}

export type Field = 'weight' | 'note';

const MC_HEADING = /^##\s+Микроциклы\s*$/i;
const JOURNAL_HEADING = /^##\s+Журнал\s*$/i;
const H2 = /^##\s+(.+?)\s*$/;
const H3 = /^###\s+(?:(\d+[\wа-яё]*)\.\s+)?(.+?)\s*$/i;
const REST = /^(?:Темп\s*\/\s*отдых|Отдых)\s*:\s*(.*)$/i;
const TABLE_HEAD = /^\|\s*МЦ\s*\|/i;
const DONE_RE = /пропущ|⏭/i;

/** Ячейки строки таблицы с учётом экранированного \|. */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && body[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (body[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += body[i];
  }
  cells.push(cur.trim());
  return cells;
}

const escapeCell = (s: string) => s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();

export function formatRow(cells: string[]): string {
  return `| ${cells.map(escapeCell).join(' | ')} |`;
}

export const shortName = (name: string) => name.split(':')[0].trim();

/** Номер тренировки по названию из журнала/дневника: полное имя или короткое. */
export function workoutIndex(names: string[], text: string): number {
  const t = text.trim();
  // Сначала длинные варианты, чтобы «Тренировка 1» не съела «Тренировка 10».
  const hit = names
    .flatMap((name, i) => [
      { name, i },
      { name: shortName(name), i },
    ])
    .sort((a, b) => b.name.length - a.name.length)
    .find(({ name }) => t === name || t.startsWith(`${name}:`) || t.startsWith(`${name} `));
  return hit ? hit.i : -1;
}

const trimBlank = (lines: string[]) => {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
};

const isTableLine = (l: string) => l.trim().startsWith('|');

export function parsePlan(text: string): Plan {
  const lines = text.split('\n');

  // 1. Разбиваем на разделы по заголовкам ## (вне блоков кода).
  const heads: { line: number; title: string }[] = [];
  let inCode = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) inCode = !inCode;
    else if (!inCode && H2.test(l) && !l.startsWith('###')) heads.push({ line: i, title: H2.exec(l)![1] });
  });

  // Если есть и «Микроциклы», и «Журнал» после них — всё между ними тренировки (даже пустые,
  // только что созданные в редакторе). Иначе (старые заметки) тренировку узнаём по таблицам МЦ.
  const mcHead = heads.findIndex((h) => MC_HEADING.test(lines[h.line]));
  const jHead = heads.findIndex((h) => JOURNAL_HEADING.test(lines[h.line]));
  const bounded = mcHead >= 0 && jHead > mcHead;

  const mcNames: string[] = [];
  const workouts: Workout[] = [];
  const journalRows: { date: string; mc: number; name: string; status: Status; note: string }[] = [];
  const sections: (Section & { from: number; to: number; managed: boolean })[] = [];

  heads.forEach((h, hi) => {
    const from = h.line;
    const to = hi + 1 < heads.length ? heads[hi + 1].line : lines.length;
    const body = lines.slice(from + 1, to);

    if (MC_HEADING.test(lines[from])) {
      for (const l of body) {
        const m = /^\s*\d+[.)]\s+(.+?)\s*$/.exec(l);
        if (m) mcNames.push(m[1]);
      }
      sections.push({ kind: 'mc', from, to, managed: true });
      return;
    }

    if (JOURNAL_HEADING.test(lines[from])) {
      const head = body.findIndex((l) => /^\|\s*Дата\s*\|/i.test(l.trim()));
      if (head >= 0) {
        for (let j = head + 2; j < body.length && isTableLine(body[j]); j++) {
          const [date = '', mc = '', name = '', status = '', note = ''] = splitRow(body[j]);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parseInt(mc, 10))) continue;
          journalRows.push({ date, mc: parseInt(mc, 10), name, status: DONE_RE.test(status) ? 'skipped' : 'done', note });
        }
      }
      sections.push({ kind: 'journal', from, to, managed: true });
      return;
    }

    // Тренировка — раздел, в котором есть хотя бы одно упражнение с таблицей МЦ.
    const workout: Workout = { name: h.title, short: shortName(h.title), intro: [], exercises: [], line: from };
    let ex: Exercise | null = null;
    for (let k = 0; k < body.length; k++) {
      const i = from + 1 + k;
      const l = body[k];
      const h3 = H3.exec(l);
      if (h3) {
        ex = { order: h3[1] ?? '', name: h3[2], rest: '', extra: [], rows: [], line: i };
        workout.exercises.push(ex);
        continue;
      }
      if (!ex) {
        workout.intro.push(l);
        continue;
      }
      const rest = REST.exec(l.trim());
      if (rest && !ex.rest && !ex.rows.length) {
        ex.rest = rest[1].trim();
        continue;
      }
      if (TABLE_HEAD.test(l.trim()) && !ex.rows.length) {
        let j = k + 2;
        for (; j < body.length && isTableLine(body[j]); j++) {
          const [mc, sp = '', weight = '', note = ''] = splitRow(body[j]);
          const n = parseInt(mc, 10);
          if (!Number.isNaN(n)) ex.rows.push({ mc: n, sp, weight, note, line: from + 1 + j });
        }
        k = j - 1;
        continue;
      }
      ex.extra.push(l);
    }
    // «###» без таблицы — не упражнение, а пометка: приклеиваем её текст к предыдущему упражнению
    // (или к вступлению тренировки), чтобы при пересборке ничего не пропало.
    const real: Exercise[] = [];
    for (const e of workout.exercises) {
      if (e.rows.length) {
        real.push(e);
        continue;
      }
      const text = [lines[e.line], ...(e.rest ? [`Темп/отдых: ${e.rest}`] : []), ...e.extra];
      // Хвостовые пустые строки убираем, иначе каждая пересборка добавляла бы ещё одну.
      const target = real.length ? real[real.length - 1].extra : workout.intro;
      while (target.length && !target[target.length - 1].trim()) target.pop();
      target.push(...(target.length ? [''] : []), ...text);
    }
    const isWorkout = bounded ? hi > mcHead && hi < jHead : real.length > 0;
    if (isWorkout) {
      workout.exercises = real;
      workouts.push(workout);
      sections.push({ kind: 'workout', workout, from, to, managed: true });
    } else {
      sections.push({ kind: 'text', lines: lines.slice(from, to), from, to, managed: false });
    }
  });

  // 2. «Своя» часть — от первого до последнего своего раздела; посторонние разделы внутри неё сохраняем.
  const firstManaged = sections.findIndex((s) => s.managed);
  let lastManaged = -1;
  sections.forEach((s, i) => {
    if (s.managed) lastManaged = i;
  });
  const region = firstManaged >= 0 ? { start: sections[firstManaged].from, end: sections[lastManaged].to } : null;
  const inRegion = firstManaged >= 0 ? sections.slice(firstManaged, lastManaged + 1) : [];

  // Список микроциклов можно не писать — тогда «Микроцикл N» по числу строк.
  if (!mcNames.length) {
    const max = Math.max(0, ...workouts.flatMap((w) => w.exercises.flatMap((e) => e.rows.map((r) => r.mc))));
    for (let n = 1; n <= max; n++) mcNames.push(`Микроцикл ${n}`);
  }

  const names = workouts.map((w) => w.name);
  const journal: JournalRow[] = journalRows
    .map((r) => ({ date: r.date, mc: r.mc, workout: workoutIndex(names, r.name) + 1, status: r.status, note: r.note }))
    .filter((r) => r.workout > 0);

  return {
    mcNames,
    workouts,
    journal,
    hasJournal: sections.some((s) => s.kind === 'journal'),
    sections: inRegion.map(({ from, to, managed, ...s }) => s as Section),
    region,
  };
}

// ---------- Сборка обратно ----------

function serializeWorkout(w: Workout, mcCount: number): string[] {
  const out = [`## ${w.name}`];
  const intro = trimBlank(w.intro);
  if (intro.length) out.push('', ...intro);
  w.exercises.forEach((ex, i) => {
    out.push('', `### ${i + 1}. ${ex.name}`);
    if (ex.rest) out.push(`Темп/отдых: ${ex.rest}`);
    out.push('', '| МЦ | С×П | Вес | Заметка |', '|----|-----|-----|---------|');
    for (let mc = 1; mc <= mcCount; mc++) {
      const r = ex.rows.find((x) => x.mc === mc);
      out.push(formatRow([String(mc), r?.sp ?? '', r?.weight ?? '', r?.note ?? '']));
    }
    const extra = trimBlank(ex.extra);
    if (extra.length) out.push('', ...extra);
  });
  return out;
}

const STATUS_CELL: Record<Status, string> = { done: '✅', skipped: '⏭️ пропущена' };

function serializeJournal(plan: Plan): string[] {
  const rows = [...plan.journal].sort((a, b) => a.date.localeCompare(b.date) || a.mc - b.mc || a.workout - b.workout);
  return [
    '## Журнал',
    '',
    '| Дата | МЦ | Тренировка | Статус | Заметка |',
    '|------|----|------------|--------|---------|',
    ...rows.map((r) => formatRow([r.date, String(r.mc), plan.workouts[r.workout - 1]?.short ?? '', STATUS_CELL[r.status], r.note])),
  ];
}

/** Собирает «свою» часть заметки из модели и подставляет её на место старой. */
export function serializePlan(text: string, plan: Plan): string {
  const blocks: string[][] = [];
  const mcBlock = ['## Микроциклы', '', ...plan.mcNames.map((n, i) => `${i + 1}. ${n}`)];
  let wi = 0;
  let mcDone = false;
  let journalDone = false;

  for (const s of plan.sections) {
    if (s.kind === 'mc') {
      blocks.push(mcBlock);
      mcDone = true;
    } else if (s.kind === 'workout') {
      // Тренировки выводим по порядку модели: их могли добавить, удалить или переставить.
      if (wi === 0) {
        if (!mcDone) {
          blocks.push(mcBlock);
          mcDone = true;
        }
        for (const w of plan.workouts) blocks.push(serializeWorkout(w, plan.mcNames.length));
      }
      wi++;
    } else if (s.kind === 'journal') {
      blocks.push(serializeJournal(plan));
      journalDone = true;
    } else {
      blocks.push(trimBlank(s.lines));
    }
  }
  if (!mcDone) blocks.unshift(mcBlock);
  if (wi === 0) for (const w of plan.workouts) blocks.push(serializeWorkout(w, plan.mcNames.length));
  // Журнал пишем всегда: он же отмечает конец «своей» части заметки.
  if (!journalDone) blocks.push(serializeJournal(plan));

  const region = blocks.map((b) => b.join('\n')).join('\n\n');
  const lines = text.split('\n');
  if (!plan.region) {
    const body = text.replace(/\s+$/, '');
    return `${body}${body ? '\n\n' : ''}${region}\n`;
  }
  const before = lines.slice(0, plan.region.start).join('\n').replace(/\s+$/, '');
  const after = lines.slice(plan.region.end).join('\n').replace(/^\s+/, '');
  return `${before ? `${before}\n\n` : ''}${region}\n${after ? `\n${after}` : ''}`;
}

/** Разобрать → изменить → собрать. */
export function mutatePlan(text: string, fn: (plan: Plan) => void): string {
  const plan = parsePlan(text);
  fn(plan);
  return serializePlan(text, plan);
}

/**
 * Меняет одну ячейку (вес или заметку) — точечно, одной строкой, без пересборки:
 * это самая частая правка, и она не должна трогать остальную заметку.
 */
export function setCell(text: string, w: number, e: number, mc: number, field: Field, value: string): string {
  const plan = parsePlan(text);
  const ex = plan.workouts[w]?.exercises[e];
  const row = ex?.rows.find((r) => r.mc === mc);
  if (!ex || !row) throw new Error('упражнение не найдено в заметке плана');
  const lines = text.split('\n');
  const cells = splitRow(lines[row.line]);
  while (cells.length < 4) cells.push('');
  cells[field === 'weight' ? 2 : 3] = value;
  lines[row.line] = formatRow(cells);
  return lines.join('\n');
}

/** Текст новой заметки-плана: пустой план или копия структуры другого (без весов, заметок и журнала). */
export function newPlanText(title: string, mcCount: number, today: string, from?: Plan): string {
  const plan: Plan = {
    mcNames: from ? [...from.mcNames] : Array.from({ length: mcCount }, (_, i) => `Микроцикл ${i + 1}`),
    workouts: from
      ? from.workouts.map((w) => ({
          ...w,
          intro: [],
          line: -1,
          exercises: w.exercises.map((e) => ({ ...e, extra: [], line: -1, rows: e.rows.map((r) => ({ ...r, weight: '', note: '', line: -1 })) })),
        }))
      : [{ name: 'Тренировка 1', short: 'Тренировка 1', intro: [], exercises: [], line: -1 }],
    journal: [],
    hasJournal: true,
    sections: [],
    region: null,
  };
  const head = ['---', `title: ${title}`, `created: ${today}`, 'zhelezo: active', '---', '', `# 🏋️ ${title}`].join('\n');
  return serializePlan(head, plan);
}

// ---------- Перенос из старого формата (dataviewjs + JSON) ----------

export interface LegacyData {
  mc_names: string[];
  workouts: {
    name: string;
    exercises: { order: string; name: string; rest: string; cycles: { sp: string; ves: string; fb: string }[] }[];
  }[];
}

/** Пустые подсказки из шаблона («вес?») — это не вес, а приглашение его вписать. */
const PLACEHOLDER = /^(?:вес|время|повторения)\?(?:\s*\/\s*(?:вес|время|повторения)\?)*$/i;

export function legacyToMarkdown(data: LegacyData): string {
  const plan: Plan = {
    mcNames: data.mc_names,
    journal: [],
    hasJournal: false,
    sections: [{ kind: 'mc' }],
    region: null,
    workouts: data.workouts.map((w) => ({
      name: w.name,
      short: shortName(w.name),
      intro: [],
      line: -1,
      exercises: w.exercises.map((ex) => ({
        order: ex.order,
        name: ex.name,
        rest: ex.rest,
        extra: [],
        line: -1,
        rows: ex.cycles.map((c, i) => ({
          mc: i + 1,
          // «2*10» в таблице markdown может стать курсивом — пишем «2×10».
          sp: (c.sp ?? '').replace(/\*/g, '×'),
          weight: PLACEHOLDER.test((c.ves ?? '').trim()) ? '' : c.ves ?? '',
          note: c.fb ?? '',
          line: -1,
        })),
      })),
    })),
  };
  return serializePlan('', plan).trim();
}

/** Находит в заметке старый блок dataviewjs с планом. */
export function findLegacyBlock(text: string): { start: number; end: number; defaults: LegacyData | null } | null {
  const re = /```dataviewjs\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!/const defaultData\s*=/.test(m[1]) || !/-data\.json/.test(m[1])) continue;
    let defaults: LegacyData | null = null;
    const json = /const defaultData\s*=\s*(\{[\s\S]*?\n\});/.exec(m[1]);
    if (json) {
      try {
        defaults = JSON.parse(json[1]);
      } catch {
        defaults = null;
      }
    }
    return { start: m.index, end: m.index + m[0].length, defaults };
  }
  return null;
}

/** Заменяет блок dataviewjs на markdown-план. Всё остальное в заметке не трогается. */
export function migrateNote(text: string, data: LegacyData): string {
  const block = findLegacyBlock(text);
  if (!block) throw new Error('в заметке нет блока dataviewjs с планом');
  return text.slice(0, block.start) + legacyToMarkdown(data) + text.slice(block.end);
}
