import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as E from '../src/edit';
import { addEntry, entryLine, nextWorkout, parseEntries, removeEntry } from '../src/journal';
import { findLegacyBlock, LegacyData, migrateNote, mutatePlan, newPlanText, parsePlan, setCell, splitRow } from '../src/plan';

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const legacy: LegacyData = JSON.parse(fx('legacy-data.json'));
const legacyNote = fx('legacy-note.md');
const daily = fx('daily.md');
const migrated = migrateNote(legacyNote, legacy);

test('перенос: блок dataviewjs заменяется markdown, остальное не трогается', () => {
  const block = findLegacyBlock(legacyNote)!;
  assert.equal(block.defaults?.workouts.length, 2);
  assert.ok(!migrated.includes('dataviewjs'));
  assert.ok(migrated.startsWith(legacyNote.slice(0, block.start)));
  assert.ok(migrated.includes('## 📝 Заметки по программе\n\n- **С/В** — собственный вес.'));
});

test('перенос: веса и заметки сохраняются, подсказки «вес?» убираются, 2*8 → 2×8', () => {
  const plan = parsePlan(migrated);
  assert.deepEqual(plan.mcNames, legacy.mc_names);
  assert.deepEqual(plan.workouts.map((w) => [w.name, w.short, w.exercises.length]), [
    ['Тренировка 1: низ', 'Тренировка 1', 3],
    ['Тренировка 2: верх', 'Тренировка 2', 3],
  ]);
  const squat = plan.workouts[0].exercises[1];
  assert.deepEqual([squat.order, squat.name, squat.rest], ['2', 'Присед со штангой', '3010/до 120 сек']);
  assert.deepEqual(squat.rows.map((r) => [r.mc, r.sp, r.weight, r.note]), [
    [1, '2×8', '60', ''],
    [2, '3×8', '65', 'тяжело | но ок'],
    [3, '3×6', '', ''],
    [4, '2×8', '', ''],
  ]);
  assert.equal(plan.workouts[0].exercises[0].rows[0].weight, 'ИВН 6');
  assert.equal(plan.workouts[0].exercises[2].rows[0].weight, '');
  assert.equal(plan.hasJournal, true);
});

test('пересборка без изменений сохраняет план и весь посторонний текст', () => {
  const withNotes = migrated.replace(
    '| 4 | 2×8 |  |  |\n\n### 3. Выпады',
    '| 4 | 2×8 |  |  |\n\nСтарался держать спину.\n\n### Подсказка без таблицы\nтекст подсказки\n\n### 3. Выпады'
  );
  const once = mutatePlan(withNotes, () => {});
  const twice = mutatePlan(once, () => {});
  assert.equal(once, twice, 'пересборка устойчива');
  assert.deepEqual(parsePlan(once).workouts.map((w) => w.exercises.map((e) => e.name)), parsePlan(withNotes).workouts.map((w) => w.exercises.map((e) => e.name)));
  for (const piece of ['# 🏋️ План для тестов', '> [!info] О программе', 'Старался держать спину.', '### Подсказка без таблицы', 'текст подсказки', '## 📝 Заметки по программе', '- **С/В** — собственный вес.', 'tags:\n  - спорт']) {
    assert.ok(once.includes(piece), `потерялось: ${piece}`);
  }
  // Журнал встаёт после тренировок, до «Заметок по программе».
  assert.ok(once.indexOf('## Журнал') < once.indexOf('## 📝 Заметки по программе'));
});

test('setCell меняет одну строку; | в тексте экранируется', () => {
  const out = setCell(migrated, 0, 1, 3, 'weight', '70');
  const a = migrated.split('\n');
  const b = out.split('\n');
  assert.equal(a.filter((l, i) => l !== b[i]).length, 1);
  assert.equal(parsePlan(out).workouts[0].exercises[1].rows[2].weight, '70');
  const out2 = setCell(out, 0, 1, 3, 'note', 'на 2 | 3 подходе тяжело');
  assert.equal(parsePlan(out2).workouts[0].exercises[1].rows[2].note, 'на 2 | 3 подходе тяжело');
  assert.deepEqual(splitRow('| 3 | 3×6 | 70 | a \\| b |'), ['3', '3×6', '70', 'a | b']);
  assert.throws(() => setCell(out, 5, 0, 1, 'weight', '1'), /не найдено/);
});

test('редактор: тренировки — добавить пустую, переименовать, переставить, удалить; журнал следует', () => {
  let text = mutatePlan(migrated, (p) => {
    E.addJournal(p, { date: '2026-10-01', mc: 1, workout: 1, status: 'done', note: '' });
    E.addJournal(p, { date: '2026-10-03', mc: 1, workout: 2, status: 'skipped', note: 'болел' });
  });
  // Пустая тренировка переживает повторный разбор.
  text = mutatePlan(text, (p) => E.addWorkout(p, 'Тренировка 3: кардио'));
  let plan = parsePlan(text);
  assert.deepEqual(plan.workouts.map((w) => w.short), ['Тренировка 1', 'Тренировка 2', 'Тренировка 3']);
  assert.equal(plan.workouts[2].exercises.length, 0);

  text = mutatePlan(text, (p) => E.moveWorkout(p, 1, 0));
  plan = parsePlan(text);
  assert.deepEqual(plan.workouts.map((w) => w.short), ['Тренировка 2', 'Тренировка 1', 'Тренировка 3']);
  // Журнал ссылается на тренировки по названию — после перестановки всё на месте.
  assert.deepEqual(plan.journal.map((j) => [j.date, plan.workouts[j.workout - 1].short, j.status, j.note]), [
    ['2026-10-01', 'Тренировка 1', 'done', ''],
    ['2026-10-03', 'Тренировка 2', 'skipped', 'болел'],
  ]);

  text = mutatePlan(text, (p) => E.renameWorkout(p, 1, 'Ноги: присед и выпады'));
  plan = parsePlan(text);
  assert.equal(plan.journal.find((j) => j.date === '2026-10-01')!.workout, 2);
  assert.equal(plan.workouts[1].short, 'Ноги');

  text = mutatePlan(text, (p) => E.deleteWorkout(p, 1));
  plan = parsePlan(text);
  assert.deepEqual(plan.workouts.map((w) => w.short), ['Тренировка 2', 'Тренировка 3']);
  assert.deepEqual(plan.journal.map((j) => j.date), ['2026-10-03']);
});

test('редактор: упражнения и подходы, микроциклы', () => {
  let text = mutatePlan(migrated, (p) => {
    const e = E.addExercise(p, 1, 'Подтягивания', '3*макс', 'до 120 сек');
    E.setSp(p, 1, e, 4, '2*макс');
    E.updateExercise(p, 0, 0, { name: 'Разминка', rest: '' });
    E.moveExercise(p, 0, 2, 0);
  });
  let plan = parsePlan(text);
  const pull = plan.workouts[1].exercises[3];
  assert.deepEqual([pull.name, pull.rest, pull.rows.map((r) => r.sp)], ['Подтягивания', 'до 120 сек', ['3×макс', '3×макс', '3×макс', '2×макс']]);
  assert.deepEqual(plan.workouts[0].exercises.map((e) => e.name), ['Выпады с гантелями', 'Разминка', 'Присед со штангой']);
  // Веса переехали вместе с упражнением.
  assert.equal(plan.workouts[0].exercises[2].rows[0].weight, '60');

  text = mutatePlan(text, (p) => {
    E.addMc(p);
    E.renameMc(p, 4, 'Микроцикл 5 (тест)');
  });
  plan = parsePlan(text);
  assert.equal(plan.mcNames.length, 5);
  assert.equal(plan.workouts[0].exercises[2].rows[4].sp, '2×8', 'новый МЦ копирует подходы из последнего');

  text = mutatePlan(text, (p) => E.removeLastMc(p));
  assert.equal(parsePlan(text).mcNames.length, 4);

  text = mutatePlan(text, (p) => E.deleteExercise(p, 1, 3));
  assert.equal(parsePlan(text).workouts[1].exercises.length, 3);
});

test('журнал: пропуск заменяется выполнением, перенос даты, удаление', () => {
  let text = mutatePlan(migrated, (p) => E.addJournal(p, { date: '2026-10-05', mc: 2, workout: 1, status: 'skipped', note: '' }));
  text = mutatePlan(text, (p) => E.addJournal(p, { date: '2026-10-06', mc: 2, workout: 1, status: 'done', note: 'догнал' }));
  let plan = parsePlan(text);
  assert.deepEqual(plan.journal.map((j) => [j.date, j.status, j.note]), [['2026-10-06', 'done', 'догнал']]);
  text = mutatePlan(text, (p) => E.moveJournal(p, p.journal[0], '2026-10-07'));
  assert.equal(parsePlan(text).journal[0].date, '2026-10-07');
  text = mutatePlan(text, (p) => E.removeJournal(p, p.journal[0]));
  assert.equal(parsePlan(text).journal.length, 0);
});

test('новый план: пустой и копия структуры без весов', () => {
  const empty = parsePlan(newPlanText('Новый план', 6, '2026-10-08'));
  assert.equal(empty.mcNames.length, 6);
  assert.deepEqual(empty.workouts.map((w) => w.name), ['Тренировка 1']);

  const copyText = newPlanText('Копия', 0, '2026-10-08', parsePlan(migrated));
  assert.ok(copyText.startsWith('---\ntitle: Копия\ncreated: 2026-10-08\nzhelezo: active\n---'));
  const copy = parsePlan(copyText);
  assert.equal(copy.workouts.length, 2);
  assert.equal(copy.workouts[0].exercises[1].rows[1].sp, '3×8');
  assert.ok(copy.workouts.every((w) => w.exercises.every((e) => e.rows.every((r) => !r.weight && !r.note))));
});

test('ежедневная заметка: строка под привычкой, без дублей, удаление', () => {
  const names = legacy.workouts.map((w) => w.name);
  const line = entryLine(3, names[1], '[[План для тестов|план]]');
  const { text, added } = addEntry(daily, line, { mc: 3, workout: 2 }, names, /физическ|спорт/i);
  assert.ok(added);
  assert.ok(text.includes('- [x] 🏃 Физическая активность\n\t- 🏋️ МЦ3 · Тренировка 2: верх'));
  assert.deepEqual(parseEntries(text, names), [{ mc: 3, workout: 2 }]);
  assert.equal(addEntry(text, line, { mc: 3, workout: 2 }, names, /физическ/i).added, false);

  const back = removeEntry(text, { mc: 3, workout: 2 }, names);
  assert.ok(back.removed);
  assert.equal(parseEntries(back.text, names).length, 0);
  assert.ok(back.text.includes('- [x] 🏃 Физическая активность'), 'галочку привычки не снимаем');
  assert.equal(addEntry('# День\n', line, { mc: 3, workout: 2 }, names, /физическ/i).text, `# День\n\n- ${line}\n`);
});

test('следующая тренировка: по журналу с пропусками, без журнала — по весам', () => {
  const j = (mc: number, workout: number, status: 'done' | 'skipped' = 'done') => ({ date: '2026-10-01', mc, workout, status, note: '' });
  assert.deepEqual(nextWorkout([], null, 4, 2), { mc: 1, workout: 1 });
  assert.deepEqual(nextWorkout([], { mc: 2, workout: 2 }, 4, 2), { mc: 3, workout: 1 });
  assert.deepEqual(nextWorkout([j(3, 1)], null, 4, 2), { mc: 3, workout: 2 });
  assert.deepEqual(nextWorkout([j(3, 1), j(3, 2, 'skipped')], null, 4, 2), { mc: 4, workout: 1 });
  // Сделал не по порядку: дыра в МЦ3 Т2 предлагается первой.
  assert.deepEqual(nextWorkout([j(3, 1), j(4, 1)], null, 4, 2), { mc: 3, workout: 2 });
  assert.equal(nextWorkout([j(4, 1), j(4, 2)], null, 4, 2), null);
});
