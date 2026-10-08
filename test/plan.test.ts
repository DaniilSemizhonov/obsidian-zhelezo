import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { findLegacyBlock, LegacyData, legacyToMarkdown, migrateNote, parsePlan, setCell, splitRow } from '../src/plan';
import { addEntry, entryLine, HistoryItem, nextWorkout, parseEntries } from '../src/journal';

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const legacy: LegacyData = JSON.parse(fx('legacy-data.json'));
const legacyNote = fx('legacy-note.md');
const daily = fx('daily.md');

test('перенос: блок dataviewjs заменяется markdown, остальное не трогается', () => {
  const block = findLegacyBlock(legacyNote)!;
  assert.ok(block);
  assert.equal(block.defaults?.workouts.length, 2);

  const out = migrateNote(legacyNote, legacy);
  assert.ok(!out.includes('dataviewjs'));
  assert.ok(out.startsWith(legacyNote.slice(0, block.start)));
  assert.ok(out.endsWith(legacyNote.slice(block.end)));
  assert.ok(out.includes('## 📝 Заметки по программе'));
});

test('перенос: веса и заметки сохраняются, подсказки «вес?» убираются, 2*8 → 2×8', () => {
  const plan = parsePlan(migrateNote(legacyNote, legacy));
  assert.deepEqual(plan.mcNames, legacy.mc_names);
  assert.deepEqual(plan.workouts.map((w) => [w.name, w.short, w.exercises.length]), [
    ['Тренировка 1: низ', 'Тренировка 1', 3],
    ['Тренировка 2: верх', 'Тренировка 2', 3],
  ]);
  const squat = plan.workouts[0].exercises[1];
  assert.equal(squat.order, '2');
  assert.equal(squat.name, 'Присед со штангой');
  assert.equal(squat.rest, '3010/до 120 сек');
  assert.deepEqual(squat.rows.map((r) => [r.mc, r.sp, r.weight, r.note]), [
    [1, '2×8', '60', ''],
    [2, '3×8', '65', 'тяжело | но ок'],
    [3, '3×6', '', ''],
    [4, '2×8', '', ''],
  ]);
  // «ИВН 6» — не подсказка, остаётся; «вес?/повторения?» и «время?» — подсказки.
  assert.equal(plan.workouts[0].exercises[0].rows[0].weight, 'ИВН 6');
  assert.equal(plan.workouts[0].exercises[2].rows[0].weight, '');
  assert.equal(plan.workouts[1].exercises[2].rows[0].weight, '');
  assert.equal(plan.workouts[0].exercises[0].rest, '');
});

test('setCell меняет одну строку; | в тексте экранируется', () => {
  const text = migrateNote(legacyNote, legacy);
  const out = setCell(text, 0, 1, 3, 'weight', '70');
  const a = text.split('\n');
  const b = out.split('\n');
  const diff = a.map((l, i) => (l === b[i] ? null : i)).filter((i) => i !== null);
  assert.equal(diff.length, 1);
  assert.equal(parsePlan(out).workouts[0].exercises[1].rows[2].weight, '70');

  const out2 = setCell(out, 0, 1, 3, 'note', 'на 2 | 3 подходе тяжело');
  assert.equal(parsePlan(out2).workouts[0].exercises[1].rows[2].note, 'на 2 | 3 подходе тяжело');
  assert.deepEqual(splitRow('| 3 | 3×6 | 70 | a \\| b |'), ['3', '3×6', '70', 'a | b']);
  assert.throws(() => setCell(out, 5, 0, 1, 'weight', '1'), /не найдено/);
});

test('план, написанный руками, без списка микроциклов', () => {
  const md = ['## Ноги', '', '### Присед', '| МЦ | С×П | Вес | Заметка |', '|---|---|---|---|', '| 1 | 3×5 | 80 | |', '| 2 | 3×5 | | |', '', '## Просто раздел', 'текст'].join('\n');
  const plan = parsePlan(md);
  assert.deepEqual(plan.mcNames, ['Микроцикл 1', 'Микроцикл 2']);
  assert.equal(plan.workouts.length, 1);
  assert.equal(plan.workouts[0].exercises[0].order, '');
});

test('ежедневная заметка: галочка привычки + вложенная строка, без дублей', () => {
  const names = legacy.workouts.map((w) => w.name);
  const line = entryLine(3, names[1], '[[План для тестов|план]]');
  assert.equal(line, '🏋️ МЦ3 · Тренировка 2: верх · [[План для тестов|план]]');

  const { text, added } = addEntry(daily, line, { mc: 3, workout: 2 }, names, /физическ|спорт/i);
  assert.ok(added);
  assert.ok(text.includes('- [x] 🏃 Физическая активность\n\t- 🏋️ МЦ3 · Тренировка 2: верх'));
  assert.ok(text.includes('- [ ] 📖 Чтение'));
  assert.deepEqual(parseEntries(text, names), [{ mc: 3, workout: 2 }]);

  const again = addEntry(text, line, { mc: 3, workout: 2 }, names, /физическ/i);
  assert.equal(again.added, false);
  assert.equal(again.text, text);

  // Без привычки — в конец заметки.
  const plain = addEntry('# День\n', line, { mc: 3, workout: 2 }, names, /физическ/i);
  assert.equal(plain.text, `# День\n\n- ${line}\n`);
});

test('распознавание: короткое имя, «Тренировка 1» не путается с «Тренировка 10»', () => {
  const names = ['Тренировка 1: низ', 'Тренировка 10: всё тело'];
  assert.deepEqual(parseEntries('- 🏋️ МЦ2 · Тренировка 10: всё тело · [[x]]\n- 🏋️ МЦ1 · Тренировка 1 · [[x]]', names), [
    { mc: 2, workout: 2 },
    { mc: 1, workout: 1 },
  ]);
});

test('следующая тренировка', () => {
  const h = (date: string, mc: number, workout: number): HistoryItem => ({ date, mc, workout, path: '' });
  assert.deepEqual(nextWorkout([], null, 4, 2), { mc: 1, workout: 1 });
  assert.deepEqual(nextWorkout([], { mc: 2, workout: 2 }, 4, 2), { mc: 3, workout: 1 });
  assert.deepEqual(nextWorkout([h('2026-10-01', 1, 1), h('2026-10-03', 1, 2)], null, 4, 2), { mc: 2, workout: 1 });
  assert.deepEqual(nextWorkout([h('2026-10-05', 2, 1)], { mc: 3, workout: 2 }, 4, 2), { mc: 2, workout: 2 });
  assert.deepEqual(nextWorkout([h('2026-10-05', 4, 2)], null, 4, 2), { mc: 4, workout: 1 });
});
