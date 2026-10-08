/* 匯入 Excel：個案聯絡資訊 與 每週排程表
   同時可在瀏覽器（window.Importer）與 Node（require）使用 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Importer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HELPERS = { '林': '林怡儒', '吳': '吳金龍', '蕭': '蕭名雅' };
  const NOTE_WORDS = ['禮拜', '小廚師', '會議', '開會', '團體', '讀書會', '晨會'];
  const DAY_NAMES = ['星期一', '星期二', '星期三', '星期四', '星期五'];

  const pad = n => String(n).padStart(2, '0');
  const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

  // Excel 日期序號 → YYYY-MM-DD（用 UTC 計算，避免時區差一天）
  function serialToYMD(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      const ms = Math.round((v - 25569) * 86400000);
      const d = new Date(ms);
      return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    if (v instanceof Date && !isNaN(v)) return ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
    if (m) return ymd(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{2,3})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/); // 民國年 114/5/3
    if (m) return ymd(+m[1] + 1911, +m[2], +m[3]);
    return null;
  }

  function normName(s) {
    return String(s == null ? '' : s).replace(/[\s　]+/g, '').trim();
  }

  // 電話整理：數字型態補 0、9 碼開頭為 9 者補 0，保留「pa / ma / 媽」等備註
  function normPhone(v) {
    if (v == null || v === '') return '';
    let s = String(v).trim().replace(/\s+/g, ' ');
    if (typeof v === 'number') {
      s = String(v);
      if (/^9\d{8}$/.test(s)) s = '0' + s;
      if (/^09\d{8}$/.test(s)) s = s.slice(0, 4) + '-' + s.slice(4, 7) + '-' + s.slice(7);
      return s;
    }
    s = s.replace(/^(9\d{8})(?!\d)/, '0$1');
    s = s.replace(/^(09\d{2})(\d{3})(\d{3})(?!\d)/, '$1-$2-$3');
    return s.trim();
  }

  function findHeader(rows, words) {
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const r = (rows[i] || []).map(c => normName(c));
      if (words.every(w => r.some(c => c.includes(w)))) return i;
    }
    return -1;
  }

  /* ---------- 個案聯絡資訊 ---------- */
  function parseContacts(rows) {
    const h = findHeader(rows, ['姓名']);
    if (h < 0) throw new Error('找不到「姓名」欄位，請確認第一列是標題列');
    const head = rows[h].map(c => normName(c));
    const col = (...names) => head.findIndex(c => names.some(n => c === n || c.includes(n)));
    const ci = {
      name: col('姓名'),
      birthday: col('生日', '出生'),
      preterm: col('早產', '週數'),
      phone: head.findIndex(c => /^(聯絡方式|電話|手機)1?$/.test(c)),
      phone2: head.findIndex(c => /^(聯絡方式|電話|手機)2$/.test(c)),
    };
    if (ci.phone < 0) ci.phone = col('聯絡', '電話');

    const report = { total: 0, noBirthday: 0, noPhone: 0, duplicates: [], merged: [] };
    const byName = new Map();
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const name = normName(r[ci.name]);
      if (!name) continue;
      report.total++;
      const rec = {
        name,
        birthday: ci.birthday >= 0 ? serialToYMD(r[ci.birthday]) : null,
        preterm: ci.preterm >= 0 && r[ci.preterm] != null && r[ci.preterm] !== '' ? String(r[ci.preterm]).trim() : '',
        phone: ci.phone >= 0 ? normPhone(r[ci.phone]) : '',
        phone2: ci.phone2 >= 0 ? normPhone(r[ci.phone2]) : '',
      };
      if (!rec.birthday) report.noBirthday++;
      if (!rec.phone && !rec.phone2) report.noPhone++;
      if (byName.has(name)) {
        const a = byName.get(name);
        const conflicts = [];
        for (const k of ['birthday', 'preterm']) {
          if (!a[k] && rec[k]) a[k] = rec[k];
          else if (a[k] && rec[k] && a[k] !== rec[k]) conflicts.push(k);
        }
        const phones = [a.phone, a.phone2, rec.phone, rec.phone2].filter(Boolean);
        const uniq = [...new Set(phones)];
        a.phone = uniq[0] || '';
        a.phone2 = uniq.slice(1).join(' / ');
        if (!report.duplicates.includes(name)) report.duplicates.push(name);
        report.merged.push({ name, conflicts, phones: uniq });
      } else {
        byName.set(name, rec);
      }
    }
    return { cases: [...byName.values()], report };
  }

  /* ---------- 排程表 ---------- */
  function resolveYear(m, d, today) {
    const t = today || new Date();
    let best = null, bestDiff = Infinity;
    for (const y of [t.getFullYear() - 1, t.getFullYear(), t.getFullYear() + 1]) {
      const diff = Math.abs(new Date(y, m - 1, d) - t);
      if (diff < bestDiff) { bestDiff = diff; best = y; }
    }
    return ymd(best, m, d);
  }

  function parseTime(s) {
    const m = String(s || '').match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
    return m ? pad(+m[1]) + ':' + m[2] : null;
  }

  function weekdayOf(dateStr) { // 1=一 ... 7=日
    const [y, m, d] = dateStr.split('-').map(Number);
    const wd = new Date(y, m - 1, d).getDay();
    return wd === 0 ? 7 : wd;
  }

  function splitName(rest, known) {
    let best = '';
    for (const n of known) if (n.length > best.length && rest.startsWith(n)) best = n;
    if (best) return [best, rest.slice(best.length)];
    if (rest.length > 3) {
      const tail = rest.slice(3);
      if (/^(筆|剪|釦|扣|平衡|吳|林|蕭|評估)/.test(tail)) return [rest.slice(0, 3), tail];
    }
    return [rest, ''];
  }

  function parseToken(tok, known, today) {
    let t = tok.replace(/，/g, ',').replace(/\boff\b/ig, '').replace(/[*＊]/g, '').trim();
    const out = { only: [], start: null, leaves: [], name: '', note: '', helper: '' };
    // 請假區間：10/12-10-19請假、10/12~10/19請假
    t = t.replace(/(\d{1,2})\/(\d{1,2})\s*[-~～－]\s*(?:(\d{1,2})[\/\-])?(\d{1,2})\s*請假/g, (_, m1, d1, m2, d2) => {
      out.leaves.push([resolveYear(+m1, +d1, today), resolveYear(+(m2 || m1), +d2, today)]);
      return '';
    });
    // 單日請假：10/12請假
    t = t.replace(/(\d{1,2})\/(\d{1,2})\s*請假/g, (_, m1, d1) => {
      const d = resolveYear(+m1, +d1, today); out.leaves.push([d, d]); return '';
    });
    // 開始日：10/14開始
    t = t.replace(/(\d{1,2})\/(\d{1,2})\s*(?:起|開始)/g, (_, m1, d1) => { out.start = resolveYear(+m1, +d1, today); return ''; });
    // 只有這幾天：10/6,13 或 10/6,10/13
    t = t.replace(/(\d{1,2})\/(\d{1,2})((?:\s*[,、]\s*\d{1,2}(?:\/\d{1,2})?)*)/g, (_, m1, d1, more) => {
      let mm = +m1;
      out.only.push(resolveYear(mm, +d1, today));
      (more.match(/\d{1,2}(?:\/\d{1,2})?/g) || []).forEach(x => {
        if (x.includes('/')) { const [a, b] = x.split('/').map(Number); mm = a; out.only.push(resolveYear(a, b, today)); }
        else out.only.push(resolveYear(mm, +x, today));
      });
      return '';
    });
    t = normName(t).replace(/[,、]+$/, '');
    if (!t) return out;
    const [name, suffix] = splitName(t, known);
    out.name = name;
    let suf = suffix;
    const hm = suf.match(/([林吳蕭])$/);
    if (hm) { out.helper = HELPERS[hm[1]]; suf = suf.slice(0, -1); }
    out.note = suf;
    return out;
  }

  function parseSchedule(rows, knownNames, today) {
    const known = (knownNames || []).map(normName).filter(Boolean);
    const h = findHeader(rows, ['星期一']);
    if (h < 0) throw new Error('找不到「星期一」標題，請確認排程表格式');
    const head = rows[h].map(c => normName(c));
    const dayCols = DAY_NAMES.map(n => head.findIndex(c => c.includes(n) || c === n.replace('星期', '週')));
    const timeCol = head.findIndex(c => c.includes('時間'));

    const slots = [], marks = [], warnings = [], memo = [];
    let seq = 0;
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const label = normName(r[0]);
      const time = parseTime(r[timeCol >= 0 ? timeCol : 1]);
      if (!time) {
        const txt = r.map(c => (c == null ? '' : String(c).trim())).filter(Boolean).join('　');
        if (txt) memo.push(txt);
        continue;
      }
      dayCols.forEach((c, di) => {
        if (c < 0) return;
        const raw = r[c];
        if (raw == null || String(raw).trim() === '') return;
        const text = String(raw).trim();
        const day = di + 1;
        if (NOTE_WORDS.some(w => text.includes(w)) && !known.some(n => text.startsWith(n))) {
          slots.push({ id: 's' + (++seq), kind: 'note', day, time, text });
          return;
        }
        const tokens = text.split(/[、]/).map(s => s.trim()).filter(Boolean);
        let last = null;
        for (const tok of tokens) {
          const p = parseToken(tok, known, today);
          if (!p.name) {
            if (last && (p.start || p.only.length || p.leaves.length)) {
              if (p.start) last.start = p.start;
              if (p.only.length) last.only = (last.only || []).concat(p.only);
              p.leaves.forEach(l => addLeaves(last, l));
            }
            continue;
          }
          const s = {
            id: 's' + (++seq), kind: 'case', day, time, name: p.name,
            note: p.note || '', helper: p.helper || '', intern: '',
            only: p.only.length ? p.only : null, start: p.start || null, end: null,
            source: tok,
          };
          if (s.only) {
            const bad = s.only.filter(d => weekdayOf(d) !== day);
            if (bad.length) warnings.push(`${DAY_NAMES[di]} ${time}「${tok}」：${bad.join('、')} 不是${DAY_NAMES[di]}，請確認日期`);
          }
          if (!known.includes(s.name)) warnings.push(`「${s.name}」在聯絡資訊中找不到`);
          slots.push(s);
          p.leaves.forEach(l => addLeaves(s, l));
          last = s;
        }
      });
    }

    function addLeaves(slot, [from, to]) {
      const [y1, m1, d1] = from.split('-').map(Number);
      const [y2, m2, d2] = to.split('-').map(Number);
      const a = new Date(y1, m1 - 1, d1), b = new Date(y2, m2 - 1, d2);
      for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
        const wd = d.getDay() === 0 ? 7 : d.getDay();
        if (wd !== slot.day) continue;
        const ds = ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
        marks.push({ id: slot.id + '|' + ds, slot: slot.id, date: ds, status: 'self' });
      }
    }

    return { slots, marks, warnings: [...new Set(warnings)], memo: memo.join('\n') };
  }

  // 兩個名字相差一個字 → 建議對應
  function suggest(name, known) {
    return known.filter(k => k.length === name.length && k !== name &&
      [...k].filter((ch, i) => ch === name[i]).length >= name.length - 1);
  }

  return { parseContacts, parseSchedule, serialToYMD, normPhone, suggest, weekdayOf, HELPERS };
});
