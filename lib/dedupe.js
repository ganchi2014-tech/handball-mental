// 名簿の重複検出・統合計画と CSV 取込解決の純関数群。
// ブラウザ(window.HMDedupe)と node(module.exports)の両方から使う。
// Firebase やDOMに触れない（テスト可能性のための制約）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HMDedupe = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 姓の正規化: NFKC（全半角統一）＋空白（全角含む）除去
  function normalizeSurname(s) {
    return String(s || '').normalize('NFKC').replace(/[\s　]+/g, '');
  }

  function dupKey(r) {
    return normalizeSurname(r && r.surname) + '|' + ((r && r.enrollmentYear) || 0);
  }

  // 同姓（正規化後）＋同入学年度のグループ（2件以上のみ）を返す。
  // 同姓でも入学年度が違えば正しい別人なのでグループにしない。
  function findRosterDuplicates(roster) {
    const groups = {};
    Object.entries(roster || {}).forEach(([id, r]) => {
      if (!r) return;
      const key = dupKey(r);
      (groups[key] = groups[key] || []).push({ id, ...r });
    });
    return Object.entries(groups)
      .filter(([, arr]) => arr.length > 1)
      .map(([key, entries]) => ({ key, entries }));
  }

  // 統合計画（実行はしない）。統合先が未指定なら「端末連携がちょうど1つならその行」を推す。
  // moveUid: 統合先が未連携で重複側にちょうど1連携 → そのuidを統合先へ移す
  // conflict: 統合先と重複側の両方に連携がある/重複側に2つ以上 → 連携を失う端末が出る
  function planMerge(group, rosterToUid, chosenCanonicalId) {
    const map = rosterToUid || {};
    const linked = group.entries.filter(e => map[e.id]);
    const canonicalId = chosenCanonicalId
      || (linked.length === 1 ? linked[0].id : group.entries[0].id);
    const deleteIds = group.entries.map(e => e.id).filter(id => id !== canonicalId);
    const unlinkIds = deleteIds.filter(id => map[id]);
    const canonicalLinked = !!map[canonicalId];
    const moveUid = (!canonicalLinked && unlinkIds.length === 1) ? map[unlinkIds[0]] : null;
    const conflict = (canonicalLinked && unlinkIds.length > 0) || unlinkIds.length > 1;
    return { canonicalId, deleteIds, unlinkIds, moveUid, conflict };
  }

  // analyzer CSV の試合ID（既存 CsvImport と同じ規則を維持: 日付_相手名の記号除去）
  function csvGameId(row) {
    const opp = String((row && row.opponent) || 'unknown')
      .replace(/[^a-zA-Z0-9一-龯ぁ-んァ-ヶ]/g, '');
    return ((row && row.date) || '') + '_' + opp;
  }

  // 名前 → rosterId。完全一致 → 学年記号(①②③)を外した正規化姓 の順に試す
  function lookupRid(nameToRid, rawName) {
    const name = String(rawName || '').trim();
    if (nameToRid[name]) return nameToRid[name];
    const bare = normalizeSurname(name.replace(/^[①②③]/, ''));
    return nameToRid[bare] || null;
  }

  // CSVパース済み行を { 試合ID → rosterId → 行[] } に解決する。
  // 攻撃行は player 列、守備行(mode==='defense')は gk 列で当該GKに配信（セーブ率用）。
  // manualMap: { 名前: rosterId | 'skip' }（未一致名のコーチ手動指定）
  function resolveCsvRows(rows, nameToRid, manualMap) {
    const byGame = {};
    const unmatched = new Set();
    let matchedRows = 0;
    (rows || []).forEach(row => {
      const isDefense = row.mode === 'defense';
      const name = isDefense ? (row.gk || '') : (row.player || '');
      if (!name) return; // 選手未指定の行は対象外（従来どおり）
      const manual = manualMap && manualMap[name];
      if (manual === 'skip') return;
      const rid = manual || lookupRid(nameToRid, name);
      if (!rid) { unmatched.add(name); return; }
      const gameId = csvGameId(row);
      const g = (byGame[gameId] = byGame[gameId] || { byRid: {} });
      (g.byRid[rid] = g.byRid[rid] || []).push(row);
      matchedRows++;
    });
    return { byGame, unmatched: Array.from(unmatched), matchedRows };
  }

  return { normalizeSurname, dupKey, findRosterDuplicates, planMerge, csvGameId, lookupRid, resolveCsvRows };
}));
