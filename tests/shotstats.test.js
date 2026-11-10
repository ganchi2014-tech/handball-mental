// 実行: node tests/shotstats.test.js
const assert = require('assert');
const S = require('../lib/shotstats.js');

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('PASS', name); }
  catch (e) { console.error('FAIL', name, '\n  ', e.message); process.exitCode = 1; }
}
const shot = (x, y, result, extra) => Object.assign({ mode: 'attack', result: result || 'goal', x, y }, extra || {});

// --- shotZone（攻撃行は上がゴール側。x,y は %。横20m・縦15m） ---
t('ゴール正面・6mライン際は 中央6m際', () => assert.strictEqual(S.shotZone(shot(50, 42)), 'c6'));
t('ゴール正面・9mライン付近は 中央9m', () => assert.strictEqual(S.shotZone(shot(50, 60)), 'c9'));
t('中央の境目: 7.5mちょうどは 6m際、超えたら 9m', () => {
  assert.strictEqual(S.shotZone(shot(50, 50)), 'c6');
  assert.strictEqual(S.shotZone(shot(50, 50.5)), 'c9');
});
t('中央の幅: 中心から3.5m未満は中央、3.5mからは45', () => {
  assert.strictEqual(S.shotZone(shot(33, 55)), 'c9');   // 3.4m左
  assert.strictEqual(S.shotZone(shot(32.5, 55)), 'l45'); // 3.5m左
  assert.strictEqual(S.shotZone(shot(67.5, 55)), 'r45');
});
t('左右のコーナー付近は サイド', () => {
  assert.strictEqual(S.shotZone(shot(5, 10)), 'lw');
  assert.strictEqual(S.shotZone(shot(95, 10)), 'rw');
});
t('6mラインの外側・浅い角度は サイド', () => assert.strictEqual(S.shotZone(shot(15, 20)), 'lw'));
t('45の9mは サイドにも中央にもしない', () => {
  assert.strictEqual(S.shotZone(shot(20, 45)), 'l45');
  assert.strictEqual(S.shotZone(shot(80, 45)), 'r45');
});
t('45は距離で分けない: 6m際まで切り込んでも 45', () => assert.strictEqual(S.shotZone(shot(30, 33)), 'l45'));
t('7mは位置に関係なく 7m', () => assert.strictEqual(S.shotZone(shot(50, 53, 'goal', { attack_type: '7m' })), '7m'));
t('位置なし（空文字・null）は null', () => {
  assert.strictEqual(S.shotZone(shot('', '')), null);
  assert.strictEqual(S.shotZone(shot(null, null)), null);
});
t('CSV由来の文字列の数字も読める', () => assert.strictEqual(S.shotZone(shot('50.00', '42.00')), 'c6'));

// --- aggregateZones ---
t('位置別: TO・守備行は数えず、0本の区分は出さず、表の順は左→右→7m', () => {
  const rows = [
    shot(50, 42, 'goal'), shot(50, 42, 'save'), shot(50, 42, 'miss'),
    shot(95, 10, 'goal'),
    shot(5, 10, 'goal'),
    shot(50, 53, 'goal', { attack_type: '7m' }),
    shot(50, 60, 'turnover'),
    { mode: 'defense', result: 'goal', x: 50, y: 60 },
    shot('', '', 'goal')
  ];
  const { list, unknown } = S.aggregateZones(rows);
  assert.deepStrictEqual(list.map(z => [z.key, z.goals, z.shots]), [['lw', 1, 1], ['c6', 1, 3], ['rw', 1, 1], ['7m', 1, 1]]);
  assert.strictEqual(unknown, 1);
});
t('位置別: 率を出すのはその区分が10本以上になってから', () => {
  const nine = Array.from({ length: 9 }, () => shot(50, 42, 'goal'));
  assert.strictEqual(S.aggregateZones(nine).list[0].showRate, false);
  const ten = nine.concat([shot(50, 42, 'miss')]);
  const z = S.aggregateZones(ten).list[0];
  assert.deepStrictEqual([z.shots, z.goals, z.rate, z.showRate], [10, 9, 90, true]);
});

// --- aggregateGkCourses ---
t('GKの抜かれたコース: 守備の枠内行だけ、6マス固定順', () => {
  const rows = [
    { mode: 'defense', result: 'goal', course: 'TL' }, { mode: 'defense', result: 'save', course: 'TL' },
    { mode: 'defense', result: 'goal', course: 'BR' },
    { mode: 'defense', result: 'miss', course: 'TL' },      // 枠外は数えない
    { mode: 'defense', result: 'goal', course: '' },        // コース未入力は数えない
    { mode: 'defense', result: 'turnover' },                // 相手のミスは数えない
    shot(50, 42, 'goal', { course: 'TL' })                  // 自分のシュートは数えない
  ];
  const { cells, total } = S.aggregateGkCourses(rows);
  assert.deepStrictEqual(cells.map(c => c.key), ['TL', 'TR', 'ML', 'MR', 'BL', 'BR']);
  assert.deepStrictEqual([cells[0].conceded, cells[0].faced], [1, 2]);
  assert.deepStrictEqual([cells[5].conceded, cells[5].faced], [1, 1]);
  assert.strictEqual(total, 3);
});
t('courseLabel: 記号を日本語に、未知はそのまま', () => {
  assert.strictEqual(S.courseLabel('TL'), '左上');
  assert.strictEqual(S.courseLabel('BR'), '右下');
  assert.strictEqual(S.courseLabel(''), '(未分類)');
  assert.strictEqual(S.courseLabel('XX'), 'XX');
});

// --- aggregateTurnoverReasons ---
t('ミスの理由別: 自分のミスだけ、理由なしは別枠、0件は出さない', () => {
  const rows = [
    { mode: 'attack', result: 'turnover', to_reason: 'pass' },
    { mode: 'attack', result: 'turnover', to_reason: 'pass' },
    { mode: 'attack', result: 'turnover', to_reason: 'foul' },
    { mode: 'attack', result: 'turnover', to_reason: '' },
    { mode: 'attack', result: 'turnover' },
    { mode: 'attack', result: 'turnover', to_reason: 'something-new' },  // 未知の理由は その他
    { mode: 'defense', result: 'turnover', to_reason: 'pass' },          // 相手のミス（GK配信行）
    shot(50, 42, 'miss')
  ];
  const { list, total } = S.aggregateTurnoverReasons(rows);
  assert.deepStrictEqual(list.map(x => [x.key, x.count]), [['pass', 2], ['foul', 1], ['other', 1], ['', 2]]);
  assert.strictEqual(total, 6);
});
t('allRows: 複数試合の行をまとめる', () => {
  assert.strictEqual(S.allRows([{ rows: [1, 2] }, { rows: [3] }, {}]).length, 3);
});

console.log(`\n${passed} passed`);
