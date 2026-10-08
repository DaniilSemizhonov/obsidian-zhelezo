// Операции редактора над моделью плана. Чистые функции, меняют модель на месте.
import { Exercise, JournalRow, Plan, PlanRow, shortName, Workout } from './plan';

const rows = (count: number, sp = ''): PlanRow[] =>
  Array.from({ length: count }, (_, i) => ({ mc: i + 1, sp, weight: '', note: '', line: -1 }));

function move<T>(list: T[], from: number, to: number) {
  if (to < 0 || to >= list.length || from === to) return;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
}

/** Журнал хранит номер тренировки — при перестановке/удалении тренировок номера нужно поправить. */
function remapJournal(plan: Plan, map: (oldIndex: number) => number | null) {
  plan.journal = plan.journal
    .map((j) => {
      const w = map(j.workout - 1);
      return w === null ? null : { ...j, workout: w + 1 };
    })
    .filter((j): j is JournalRow => !!j);
}

// ---------- Микроциклы ----------

export function renameMc(plan: Plan, i: number, name: string) {
  if (plan.mcNames[i] !== undefined) plan.mcNames[i] = name.trim() || `Микроцикл ${i + 1}`;
}

/** Новый микроцикл в конце; подходы копируются из последнего — чаще всего так и задумано. */
export function addMc(plan: Plan) {
  const n = plan.mcNames.length + 1;
  plan.mcNames.push(`Микроцикл ${n}`);
  for (const w of plan.workouts) {
    for (const ex of w.exercises) {
      const last = ex.rows.find((r) => r.mc === n - 1);
      ex.rows.push({ mc: n, sp: last?.sp ?? '', weight: '', note: '', line: -1 });
    }
  }
}

/** Удаляет последний микроцикл (вместе с весами и записями журнала в нём). */
export function removeLastMc(plan: Plan) {
  const n = plan.mcNames.length;
  if (n <= 1) return;
  plan.mcNames.pop();
  for (const w of plan.workouts) for (const ex of w.exercises) ex.rows = ex.rows.filter((r) => r.mc !== n);
  plan.journal = plan.journal.filter((j) => j.mc !== n);
}

// ---------- Тренировки ----------

export function addWorkout(plan: Plan, name?: string): number {
  const n = plan.workouts.length + 1;
  const full = name?.trim() || `Тренировка ${n}`;
  plan.workouts.push({ name: full, short: shortName(full), intro: [], exercises: [], line: -1 });
  return plan.workouts.length - 1;
}

export function renameWorkout(plan: Plan, w: number, name: string) {
  const wk = plan.workouts[w];
  if (!wk || !name.trim()) return;
  wk.name = name.trim();
  wk.short = shortName(wk.name);
}

export function deleteWorkout(plan: Plan, w: number) {
  if (!plan.workouts[w]) return;
  plan.workouts.splice(w, 1);
  remapJournal(plan, (i) => (i === w ? null : i > w ? i - 1 : i));
}

export function moveWorkout(plan: Plan, w: number, to: number) {
  if (to < 0 || to >= plan.workouts.length) return;
  const order = plan.workouts.map((_, i) => i);
  move(order, w, to);
  move(plan.workouts, w, to);
  remapJournal(plan, (i) => order.indexOf(i));
}

/** Тренировка-копия: те же упражнения и подходы, без весов и заметок. */
export function duplicateWorkout(plan: Plan, w: number): number {
  const src = plan.workouts[w];
  if (!src) return -1;
  // «Тренировка 2: верх» → «Тренировка 5: верх» (следующий свободный номер), иначе «… (копия)».
  const numbered = /^(.*?)(\d+)$/.exec(src.short);
  let name = `${src.short} (копия)${src.name.slice(src.short.length)}`;
  if (numbered) {
    const taken = new Set(plan.workouts.map((x) => x.short));
    let n = plan.workouts.length + 1;
    while (taken.has(`${numbered[1]}${n}`)) n++;
    name = `${numbered[1]}${n}${src.name.slice(src.short.length)}`;
  }
  const copy: Workout = {
    name,
    short: '',
    intro: [],
    line: -1,
    exercises: src.exercises.map((e) => ({ ...e, extra: [], line: -1, rows: e.rows.map((r) => ({ ...r, weight: '', note: '', line: -1 })) })),
  };
  copy.short = shortName(copy.name);
  plan.workouts.splice(w + 1, 0, copy);
  remapJournal(plan, (i) => (i > w ? i + 1 : i));
  return w + 1;
}

// ---------- Упражнения ----------

export function addExercise(plan: Plan, w: number, name: string, sp = '', rest = ''): number {
  const wk = plan.workouts[w];
  if (!wk) return -1;
  const ex: Exercise = { order: '', name: name.trim() || 'Новое упражнение', rest, extra: [], line: -1, rows: rows(plan.mcNames.length, sp.trim().replace(/\*/g, '×')) };
  wk.exercises.push(ex);
  return wk.exercises.length - 1;
}

export function updateExercise(plan: Plan, w: number, e: number, patch: { name?: string; rest?: string }) {
  const ex = plan.workouts[w]?.exercises[e];
  if (!ex) return;
  if (patch.name !== undefined && patch.name.trim()) ex.name = patch.name.trim();
  if (patch.rest !== undefined) ex.rest = patch.rest.trim();
}

/** Подходы×повторения в одном микроцикле. */
export function setSp(plan: Plan, w: number, e: number, mc: number, sp: string) {
  const ex = plan.workouts[w]?.exercises[e];
  if (!ex) return;
  const row = ex.rows.find((r) => r.mc === mc);
  // «3*10» → «3×10», чтобы markdown не принял звёздочку за курсив.
  const value = sp.trim().replace(/\*/g, '×');
  if (row) row.sp = value;
  else ex.rows.push({ mc, sp: value, weight: '', note: '', line: -1 });
}

/** Одно и то же во всех микроциклах. */
export function fillSp(plan: Plan, w: number, e: number, sp: string) {
  for (let mc = 1; mc <= plan.mcNames.length; mc++) setSp(plan, w, e, mc, sp);
}

export function deleteExercise(plan: Plan, w: number, e: number) {
  plan.workouts[w]?.exercises.splice(e, 1);
}

export function moveExercise(plan: Plan, w: number, e: number, to: number) {
  const list = plan.workouts[w]?.exercises;
  if (list) move(list, e, to);
}

// ---------- Журнал ----------

export function addJournal(plan: Plan, row: JournalRow): boolean {
  if (plan.journal.some((j) => j.date === row.date && j.mc === row.mc && j.workout === row.workout)) return false;
  // Одна и та же тренировка в журнале одна: повторная запись заменяет старую (например, пропуск → сделана).
  plan.journal = plan.journal.filter((j) => !(j.mc === row.mc && j.workout === row.workout));
  plan.journal.push(row);
  plan.hasJournal = true;
  return true;
}

export function removeJournal(plan: Plan, row: JournalRow) {
  plan.journal = plan.journal.filter((j) => !(j.date === row.date && j.mc === row.mc && j.workout === row.workout));
}

export function moveJournal(plan: Plan, row: JournalRow, date: string) {
  const j = plan.journal.find((x) => x.date === row.date && x.mc === row.mc && x.workout === row.workout);
  if (j) j.date = date;
}
