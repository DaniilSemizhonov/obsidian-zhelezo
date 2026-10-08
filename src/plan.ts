// Заметка с планом тренировок в markdown. Чистые функции без Obsidian API.
//
// ## Микроциклы
// 1. Микроцикл 1 (втягивающий)
// …
// ## Тренировка 1: общая, акцент спина
// ### 2. Вертикальная тяга блока
// Темп/отдых: 3111/до 180 сек
// | МЦ | С×П | Вес | Заметка |
// |----|-----|-----|---------|
// | 1  | 2×10 | 46 |         |

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
  rows: PlanRow[];
  line: number;
}

export interface Workout {
  name: string;
  /** Короткое имя для кнопок: «Тренировка 1». */
  short: string;
  exercises: Exercise[];
  line: number;
}

export interface Plan {
  mcNames: string[];
  workouts: Workout[];
}

export type Field = 'weight' | 'note';

const MC_HEADING = /^##\s+Микроциклы\s*$/i;
const H2 = /^##\s+(.+?)\s*$/;
const H3 = /^###\s+(?:(\d+[\w.]*)\.\s+)?(.+?)\s*$/;
const REST = /^(?:Темп\s*\/\s*отдых|Отдых)\s*:\s*(.*)$/i;
const TABLE_HEAD = /^\|\s*МЦ\s*\|/i;

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

export function parsePlan(text: string): Plan {
  const lines = text.split('\n');
  const mcNames: string[] = [];
  const workouts: Workout[] = [];
  let section: 'mc' | 'other' | null = null;
  let workout: Workout | null = null;
  let exercise: Exercise | null = null;
  let inCode = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) inCode = !inCode;
    if (inCode) continue;

    if (MC_HEADING.test(line)) {
      section = 'mc';
      workout = exercise = null;
      continue;
    }
    const h2 = H2.exec(line);
    if (h2 && !line.startsWith('###')) {
      section = 'other';
      exercise = null;
      // Раздел считается тренировкой, только если в нём найдётся упражнение с таблицей МЦ.
      workout = { name: h2[1], short: shortName(h2[1]), exercises: [], line: i };
      continue;
    }
    if (section === 'mc') {
      const m = /^\s*\d+[.)]\s+(.+?)\s*$/.exec(line);
      if (m) mcNames.push(m[1]);
      continue;
    }
    if (!workout) continue;

    const h3 = H3.exec(line);
    if (h3) {
      exercise = { order: h3[1] ?? '', name: h3[2], rest: '', rows: [], line: i };
      continue;
    }
    if (!exercise) continue;

    const rest = REST.exec(line.trim());
    if (rest) {
      exercise.rest = rest[1].trim();
      continue;
    }
    if (TABLE_HEAD.test(line.trim())) {
      // Строка-разделитель |---|, затем строки данных.
      let j = i + 2;
      for (; j < lines.length && lines[j].trim().startsWith('|'); j++) {
        const [mc, sp = '', weight = '', note = ''] = splitRow(lines[j]);
        const n = parseInt(mc, 10);
        if (!Number.isNaN(n)) exercise.rows.push({ mc: n, sp, weight, note, line: j });
      }
      i = j - 1;
      if (!workouts.includes(workout)) workouts.push(workout);
      workout.exercises.push(exercise);
      exercise = null;
    }
  }

  // Список микроциклов можно не писать — тогда «Микроцикл N» по числу строк.
  if (!mcNames.length) {
    const max = Math.max(0, ...workouts.flatMap((w) => w.exercises.flatMap((e) => e.rows.map((r) => r.mc))));
    for (let n = 1; n <= max; n++) mcNames.push(`Микроцикл ${n}`);
  }
  return { mcNames, workouts };
}

/**
 * Меняет одну ячейку (вес или заметку) упражнения в заданном микроцикле.
 * Ищет упражнение заново по номеру тренировки и упражнения, чтобы не промахнуться,
 * если заметку успели поправить вручную.
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
  const out: string[] = ['## Микроциклы', ''];
  data.mc_names.forEach((n, i) => out.push(`${i + 1}. ${n}`));
  for (const w of data.workouts) {
    out.push('', `## ${w.name}`);
    for (const ex of w.exercises) {
      out.push('', `### ${ex.order ? `${ex.order}. ` : ''}${ex.name}`);
      if (ex.rest) out.push(`Темп/отдых: ${ex.rest}`);
      out.push('', '| МЦ | С×П | Вес | Заметка |', '|----|-----|-----|---------|');
      ex.cycles.forEach((c, i) => {
        const weight = PLACEHOLDER.test((c.ves ?? '').trim()) ? '' : c.ves ?? '';
        // «2*10» в таблице markdown может стать курсивом — пишем «2×10».
        const sp = (c.sp ?? '').replace(/\*/g, '×');
        out.push(formatRow([String(i + 1), sp, weight, c.fb ?? '']));
      });
    }
  }
  return out.join('\n');
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
