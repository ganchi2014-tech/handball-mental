// つなぐときのPINの照合と回数の壁を、データベースの決まり（database.rules.json）だけで確かめる。
// 本物のデータベースには触らない（手元の中だけで決まりを動かす道具 targaryen を使う）。
// 動かし方（このリポジトリには package.json が無いので、道具は別の場所に入れて場所を教える）：
//   mkdir /tmp/rt && cd /tmp/rt && npm init -y && npm i targaryen@3
//   NODE_PATH=/tmp/rt/node_modules node tests/link-pin-rules.test.js
const path = require('path');
const targaryen = require('targaryen');
const fs = require('fs');
const rules = JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'database.rules.json'), 'utf8'));
const H = (c) => c.repeat(64);
const base = () => ({
  coaches: { coach1: { name: 'c' } },
  rosterToUid: { r1: 'mentalA', r2: 'mentalB', r3: 'mentalC' },
  linkPins: { mentalA: H('a'), mentalC: H('c') },   // mentalB は照合用の形を置いていない（新しいメンタルアプリをまだ開いていない人）
  linkTries: { mentalA: { 0: { labUid: 'lab1', pinHash: H('a') }, 1: { labUid: 'lab1', pinHash: H('b') }, 2: { labUid: 'lab2', pinHash: H('a') } },
               mentalB: { 0: { labUid: 'lab1', pinHash: H('a') } },
               mentalC: { 0: { labUid: 'lab1', pinHash: H('c') }, 1: { labUid: 'labOld', pinHash: H('c') }, 2: { labUid: 'labOld', pinHash: H('x') } } },
  labLinks: { mentalC: { labUid: 'labOld', rosterId: 'r3', try: '1' } },
  lab: { labOld: { declaration: { text: 'x' } } },
  declShared: { mentalC: { updatedAt: 1 } },
});
let fail = 0, n = 0;
const t = (name, got, want) => { n++; if (got !== want) { fail++; console.log('NG', name, 'got', got, 'want', want); } else console.log('ok', name); };
const db = (data, uid) => targaryen.database(rules, data || base()).as(uid ? { uid } : null);
const link = (labUid, slot, rosterId) => Object.assign({ labUid, rosterId: rosterId || 'r1', updatedAt: 1 }, slot != null ? { try: slot } : {});

console.log('── つなぐ（labLinks）');
t('PINが合った試しの席を指せば、つなげる', db(null, 'lab1').write('/labLinks/mentalA', link('lab1', '0')).allowed, true);
t('PINが違う試しの席を指しても、つなげない', db(null, 'lab1').write('/labLinks/mentalA', link('lab1', '1')).allowed, false);
t('ほかの端末の（合っている）試しの席を指しても、つなげない', db(null, 'lab1').write('/labLinks/mentalA', link('lab1', '2')).allowed, false);
t('席を指さなければ、つなげない', db(null, 'lab1').write('/labLinks/mentalA', link('lab1', null)).allowed, false);
t('無い席を指しても、つなげない', db(null, 'lab1').write('/labLinks/mentalA', link('lab1', '7')).allowed, false);
t('相手が照合用の形を置いていなければ、つなげない', db(null, 'lab1').write('/labLinks/mentalB', link('lab1', '0', 'r2')).allowed, false);
t('他人の端末の番号を名乗っては書けない', db(null, 'lab1').write('/labLinks/mentalA', link('lab2', '2')).allowed, false);
t('先に別の端末がつないでいたら、PINが合っても上書きできない', db(null, 'lab1').write('/labLinks/mentalC', link('lab1', '0', 'r3')).allowed, false);
t('つないだ本人の端末は、PINが合えば書き直せる', db(null, 'labOld').write('/labLinks/mentalC', link('labOld', '1', 'r3')).allowed, true);
t('つないだ本人の端末でも、PINが違えば書き直せない', db(null, 'labOld').write('/labLinks/mentalC', link('labOld', '2', 'r3')).allowed, false);
t('ログインしていなければ書けない', db(null, null).write('/labLinks/mentalA', link('lab1', '0')).allowed, false);

console.log('── 試しの席（linkTries）：1人につき10個まで、書き直せない');
t('空いている席には書ける', db(null, 'lab9').write('/linkTries/mentalA/3', { labUid: 'lab9', pinHash: H('q'), ts: 1 }).allowed, true);
t('うまっている席には書けない（書き直せない）', db(null, 'lab9').write('/linkTries/mentalA/0', { labUid: 'lab9', pinHash: H('q') }).allowed, false);
t('自分で書いた席でも書き直せない', db(null, 'lab1').write('/linkTries/mentalA/1', { labUid: 'lab1', pinHash: H('a') }).allowed, false);
t('11個目の席（10番）は無い', db(null, 'lab9').write('/linkTries/mentalA/10', { labUid: 'lab9', pinHash: H('q') }).allowed, false);
t('数字でない名前の席は無い', db(null, 'lab9').write('/linkTries/mentalA/x', { labUid: 'lab9', pinHash: H('q') }).allowed, false);
t('他人の端末の番号では書けない', db(null, 'lab9').write('/linkTries/mentalA/3', { labUid: 'lab1', pinHash: H('q') }).allowed, false);
t('64文字でなければ書けない', db(null, 'lab9').write('/linkTries/mentalA/3', { labUid: 'lab9', pinHash: '1234' }).allowed, false);
t('書いた端末は、自分の席を消せない', db(null, 'lab1').write('/linkTries/mentalA/1', null).allowed, false);
t('関係ない人は、席をまとめて消せない', db(null, 'lab9').write('/linkTries/mentalA', null).allowed, false);
t('本人は、席をまとめて空にできる', db(null, 'mentalA').write('/linkTries/mentalA', null).allowed, true);
t('顧問は、席をまとめて空にできる', db(null, 'coach1').write('/linkTries/mentalA', null).allowed, true);
t('本人でも、席をまとめて書きかえることはできない', db(null, 'mentalA').write('/linkTries/mentalA', { 0: { labUid: 'mentalA', pinHash: H('a') }, 5: { labUid: 'lab1', pinHash: H('a') } }).allowed, false);
t('試した端末は、席の中身を読めない', db(null, 'lab1').read('/linkTries/mentalA').allowed, false);
t('試した端末は、自分の席も読めない', db(null, 'lab1').read('/linkTries/mentalA/0').allowed, false);
t('本人は読める', db(null, 'mentalA').read('/linkTries/mentalA').allowed, true);
{ // 10個うめたあとの総当たり
  const d = base(); d.linkTries.mentalA = {}; for (let i = 0; i < 10; i++) d.linkTries.mentalA[i] = { labUid: 'evil', pinHash: H('z') };
  let ok = 0; for (let i = 0; i < 12; i++) if (db(d, 'evil2').write('/linkTries/mentalA/' + i, { labUid: 'evil2', pinHash: H('a') }).allowed) ok++;
  t('席が10個うまると、だれも試せない', ok, 0);
  let linked = 0; for (let i = 0; i < 10; i++) if (db(d, 'evil').write('/labLinks/mentalA', link('evil', String(i))).allowed) linked++;
  t('外れの10回では、つなげない', linked, 0);
}

console.log('── 今までどおりのこと');
t('つないだ端末は、つなぎを消せる', db(null, 'labOld').write('/labLinks/mentalC', null).allowed, true);
t('メンタル側の本人は、つなぎを消せる', db(null, 'mentalC').write('/labLinks/mentalC', null).allowed, true);
t('関係ない人は、つなぎを消せない', db(null, 'lab1').write('/labLinks/mentalC', null).allowed, false);
t('顧問は名簿の番号の付け替えができる（端末は変えない）', db(null, 'coach1').write('/labLinks/mentalC/rosterId', 'r9').allowed, true);
t('顧問でも、つなぐ端末は変えられない', db(null, 'coach1').write('/labLinks/mentalC', { labUid: 'coach1', rosterId: 'r3' }).allowed, false);
t('つないだ端末は、つなぎを読める', db(null, 'labOld').read('/labLinks/mentalC').allowed, true);
t('関係ない端末は、つなぎを読めない', db(null, 'lab1').read('/labLinks/mentalC').allowed, false);
t('つないだ端末は、相手のメンタルの宣言を読める', db(null, 'labOld').read('/declShared/mentalC').allowed, true);
t('つないでいない端末は、読めない', db(null, 'lab1').read('/declShared/mentalC').allowed, false);
t('メンタル側の本人は、つないだ端末の記録を読める', db(null, 'mentalC').read('/lab/labOld/declaration').allowed, true);
t('自分の記録は書ける', db(null, 'lab1').write('/lab/lab1/declaration', { text: 'y' }).allowed, true);
t('名簿と端末の対応は、今までどおり読める', db(null, 'lab1').read('/rosterToUid/r1').allowed, true);

console.log('── 照合用の形の置き場所（linkPins）');
t('本人は置ける（64文字）', db(null, 'mentalB').write('/linkPins/mentalB', H('b')).allowed, true);
t('本人でも、64文字でなければ置けない', db(null, 'mentalB').write('/linkPins/mentalB', '1234').allowed, false);
t('他人のは置けない', db(null, 'lab1').write('/linkPins/mentalA', H('z')).allowed, false);
t('本人は読める', db(null, 'mentalA').read('/linkPins/mentalA').allowed, true);
t('他人は読めない', db(null, 'lab1').read('/linkPins/mentalA').allowed, false);
t('顧問も読めない', db(null, 'coach1').read('/linkPins/mentalA').allowed, false);
t('まとめて全部は誰も読めない', db(null, 'coach1').read('/linkPins').allowed, false);
console.log(fail ? `\n${fail}/${n} 件が合わない` : `\n${n} 件すべて合った`);
process.exit(fail ? 1 : 0);
