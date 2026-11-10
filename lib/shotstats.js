// シュート行（analyzer 由来の gameStats 行）を位置・コース・ミス理由で集計する純関数群。
// ブラウザ(window.HMShotStats)と node(module.exports)の両方から使う。
// Firebase やDOMに触れない（テスト可能性のための制約）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HMShotStats = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── 位置の区分 ──
  // analyzer のコートは viewBox 400x300（横20m＝1mあたり20）。攻撃行は「上がゴール側」で x,y が % で届く。
  // ゴールは x=150〜250（中心200）、6mラインはゴール線から120、9mラインは180。
  //   ※ 6m/9mの弧の中心は x=170 と 230（直線部の両端）なので、距離は「中心から30を超えた横ずれ」で測る。
  //
  // 区分は選手が普段使う呼び名で横に切る（左サイド／左45／中央／右45／右サイド）。
  // 隣の区分どうしが数m離れているので、試合中のタップのずれに強い。
  // 距離で切るのは中央だけ（6m際のポストと9mのセンターは別物なので）。45とサイドは距離で分けない。
  const VB_W = 400, VB_H = 300;
  const ARC_HALF = 30;        // 弧の中心の横ずれ（6m/9mラインの直線部の半幅）
  const CENTER_HALF = 70;     // ゴール中心から左右3.5m以内＝中央
  const CENTER_SPLIT = 150;   // 中央の距離の境目。6m(120)と9m(180)の中間＝7.5m
  const WING_SLOPE = 0.7;     // ゴール線からの角度が約35°より浅い＝サイド
  const WING_MIN_SIDE = 60;   // かつ、弧の中心から横に3m以上離れている

  // 率を出す下限。その区分がこの本数に届くまでは本数だけ見せる（少ない本数の率は偶然で大きく動く）
  const RATE_MIN_SHOTS = 10;

  const ZONES = [
    { key: 'lw',  label: '左サイド' },
    { key: 'l45', label: '左45' },
    { key: 'c6',  label: '中央6m際' },
    { key: 'c9',  label: '中央9m' },
    { key: 'r45', label: '右45' },
    { key: 'rw',  label: '右サイド' },
    { key: '7m',  label: '7m' }      // 位置ではなく種別。表の最後に別枠で置く
  ];

  function num(v) {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  function isAttackShot(r) {
    return !!r && r.mode === 'attack' && r.result !== 'turnover';
  }

  // 行 → 'lw'|'l45'|'c6'|'c9'|'r45'|'rw'|'7m'| null（位置なし）
  // 左右は「ゴールに向かって」の左右（analyzer の攻撃画面の左右と同じ）。
  function shotZone(r) {
    if (!r) return null;
    if (r.attack_type === '7m') return '7m';
    const x = num(r.x), y = num(r.y);
    if (x == null || y == null) return null;
    const vx = x / 100 * VB_W, vy = y / 100 * VB_H;
    const dx = vx - VB_W / 2;
    const side = Math.max(0, Math.abs(dx) - ARC_HALF);
    if (Math.abs(dx) < CENTER_HALF) {
      return Math.hypot(side, vy) > CENTER_SPLIT ? 'c9' : 'c6';
    }
    const left = dx < 0;
    if (side >= WING_MIN_SIDE && vy < side * WING_SLOPE) return left ? 'lw' : 'rw';
    return left ? 'l45' : 'r45';
  }

  function rate(goals, shots) {
    return shots > 0 ? Math.round(goals / shots * 100) : 0;
  }

  // 攻撃シュート行 → 位置別 [{key,label,shots,goals,rate,showRate}]（0本の区分は除く）＋位置なしの本数
  function aggregateZones(rows) {
    const bucket = {};
    ZONES.forEach(z => { bucket[z.key] = { shots: 0, goals: 0 }; });
    let unknown = 0;
    (rows || []).forEach(r => {
      if (!isAttackShot(r)) return;
      const z = shotZone(r);
      if (!z) { unknown++; return; }
      bucket[z].shots++;
      if (r.result === 'goal') bucket[z].goals++;
    });
    const list = ZONES
      .map(z => {
        const b = bucket[z.key];
        return { key: z.key, label: z.label, shots: b.shots, goals: b.goals,
                 rate: rate(b.goals, b.shots), showRate: b.shots >= RATE_MIN_SHOTS };
      })
      .filter(z => z.shots > 0);
    return { list, unknown };
  }

  // ── コース（ゴール6分割・シューター視点） ──
  const COURSES = [
    { key: 'TL', label: '左上' }, { key: 'TR', label: '右上' },
    { key: 'ML', label: '左中' }, { key: 'MR', label: '右中' },
    { key: 'BL', label: '左下' }, { key: 'BR', label: '右下' }
  ];
  const COURSE_LABEL = {};
  COURSES.forEach(c => { COURSE_LABEL[c.key] = c.label; });

  function courseLabel(key) {
    return COURSE_LABEL[key] || key || '(未分類)';
  }

  // GKに配信された守備行（枠内＝失点 or セーブ）→ コース別 [{key,label,faced,conceded}]（6マス固定順）
  // total は コースが入っている枠内本数。向きはシューター視点（入力時と同じ）。
  function aggregateGkCourses(rows) {
    const bucket = {};
    COURSES.forEach(c => { bucket[c.key] = { faced: 0, conceded: 0 }; });
    let total = 0;
    (rows || []).forEach(r => {
      if (!r || r.mode !== 'defense') return;
      if (r.result !== 'goal' && r.result !== 'save') return;
      if (!bucket[r.course]) return;
      bucket[r.course].faced++;
      total++;
      if (r.result === 'goal') bucket[r.course].conceded++;
    });
    const cells = COURSES.map(c => ({ key: c.key, label: c.label, faced: bucket[c.key].faced, conceded: bucket[c.key].conceded }));
    return { cells, total };
  }

  // ── ミス（ターンオーバー）の理由 ──
  const TO_REASONS = [
    { key: 'pass',    label: 'パスミス' },
    { key: 'dribble', label: 'ドリブル' },
    { key: 'foul',    label: 'オフェンスファール' },
    { key: 'passive', label: 'パッシブ' },
    { key: 'other',   label: 'その他' },
    { key: '',        label: '理由の記録なし' }
  ];

  // 自分のミス行（mode=attack, result=turnover）→ 理由別 [{key,label,count}]（0件は除く）
  // GKに配信される守備行（相手のミス）は数えない。
  function aggregateTurnoverReasons(rows) {
    const bucket = {};
    TO_REASONS.forEach(t => { bucket[t.key] = 0; });
    let total = 0;
    (rows || []).forEach(r => {
      if (!r || r.mode !== 'attack' || r.result !== 'turnover') return;
      const k = Object.prototype.hasOwnProperty.call(bucket, r.to_reason) ? r.to_reason : (r.to_reason ? 'other' : '');
      bucket[k]++;
      total++;
    });
    const list = TO_REASONS.map(t => ({ key: t.key, label: t.label, count: bucket[t.key] })).filter(t => t.count > 0);
    return { list, total };
  }

  // 複数試合の行をまとめる
  function allRows(games) {
    const out = [];
    (games || []).forEach(g => { (g && g.rows || []).forEach(r => out.push(r)); });
    return out;
  }

  return { ZONES, COURSES, TO_REASONS, RATE_MIN_SHOTS,
           shotZone, aggregateZones, aggregateGkCourses, aggregateTurnoverReasons, courseLabel, allRows };
}));
