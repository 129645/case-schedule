/* 資料層：讀寫 Google 試算表（或示範模式的本機儲存），並提供排程計算 */
(function () {
  'use strict';
  const COLS = ['cases', 'slots', 'marks', 'interns', 'settings'];
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 空間不足或無痕模式 */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { } },
  };

  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
  const weekday = s => { const w = parse(s).getDay(); return w === 0 ? 7 : w; };
  const mondayOf = s => addDays(s, 1 - weekday(s));
  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const SLOT_TIMES = [];
  for (let m = 8 * 60; m < 12 * 60; m += 30) SLOT_TIMES.push(pad(Math.floor(m / 60)) + ':' + pad(m % 60));
  for (let m = 13 * 60 + 30; m < 17 * 60 + 30; m += 30) SLOT_TIMES.push(pad(Math.floor(m / 60)) + ':' + pad(m % 60));
  const endOf = t => { const [h, m] = t.split(':').map(Number); const e = h * 60 + m + 30; return pad(Math.floor(e / 60)) + ':' + pad(e % 60); };

  const THERAPISTS = ['林怡儒', '吳金龍', '蕭名雅'];
  const PALETTE = [
    { key: 'sky', name: '天藍' }, { key: 'sage', name: '鼠尾草綠' }, { key: 'butter', name: '奶油黃' }, { key: 'lilac', name: '丁香紫' },
    { key: 'rose', name: '玫瑰粉' }, { key: 'mint', name: '薄荷' }, { key: 'peach', name: '蜜桃' }, { key: 'slate', name: '霧灰藍' },
  ];
  const MAX_PER_SLOT = 6;

  async function sha(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const Store = {
    data: { cases: [], slots: [], marks: [], interns: [], settings: [] },
    online: navigator.onLine,
    remote: !!(window.APP_CONFIG && window.APP_CONFIG.apiUrl),
    listeners: [],
    lastSync: LS.get('cs_lastSync', null),

    on(fn) { this.listeners.push(fn); },
    emit() { this.listeners.forEach(fn => fn()); },

    /* ----- 連線與密碼 ----- */
    async api(body) {
      const url = window.APP_CONFIG.apiUrl;
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' });
      if (!res.ok) throw new Error('network');
      const j = await res.json();
      if (!j.ok) { const e = new Error(j.error || 'server'); e.code = j.error; throw e; }
      return j;
    },
    key() { return LS.get('cs_key', null); },
    async derive(pw) { return sha('case-schedule:' + pw); },
    async status() { return this.api({ action: 'status' }); },
    async setup(pw) { const k = await this.derive(pw); await this.api({ action: 'setup', pass: k }); LS.set('cs_key', k); },
    async login(pw) {
      const k = await this.derive(pw);
      const j = await this.api({ action: 'load', pass: k });
      LS.set('cs_key', k);
      this.applyLoad(j.data);
    },
    async changePass(pw) {
      const k = await this.derive(pw);
      await this.api({ action: 'changePass', pass: this.key(), newPass: k });
      LS.set('cs_key', k);
    },
    logout() { LS.del('cs_key'); LS.del('cs_cache'); },

    /* ----- 載入 ----- */
    applyLoad(d) {
      COLS.forEach(c => { this.data[c] = Array.isArray(d && d[c]) ? d[c] : []; });
      this.lastSync = new Date().toISOString();
      LS.set('cs_cache', this.data);
      LS.set('cs_lastSync', this.lastSync);
      this.reindex();
      this.emit();
    },
    loadCache() {
      const c = LS.get(this.remote ? 'cs_cache' : 'cs_local', null);
      if (c) { COLS.forEach(k => { this.data[k] = c[k] || []; }); this.reindex(); return true; }
      return false;
    },
    async refresh() {
      if (!this.remote) { this.loadCache(); this.emit(); return; }
      const j = await this.api({ action: 'load', pass: this.key() });
      this.applyLoad(j.data);
    },

    /* ----- 寫入 ----- */
    canEdit() { return !this.remote || this.online; },
    async save(col, items) {
      items = [].concat(items);
      const arr = this.data[col];
      items.forEach(it => { const i = arr.findIndex(x => x.id === it.id); if (i >= 0) arr[i] = it; else arr.push(it); });
      return this.commit({ action: 'put', collection: col, items });
    },
    async remove(col, ids) {
      ids = [].concat(ids);
      this.data[col] = this.data[col].filter(x => !ids.includes(x.id));
      return this.commit({ action: 'del', collection: col, ids });
    },
    async replace(col, items) {
      this.data[col] = items;
      return this.commit({ action: 'replace', collection: col, items });
    },
    async commit(op) {
      this.reindex();
      this.emit();
      if (!this.remote) { LS.set('cs_local', this.data); return; }
      LS.set('cs_cache', this.data);
      await this.api(Object.assign({ pass: this.key() }, op));
    },

    /* ----- 索引與查詢 ----- */
    reindex() {
      this.caseById = new Map(this.data.cases.map(c => [c.id, c]));
      this.caseByName = new Map(this.data.cases.map(c => [c.name, c]));
      this.markById = new Map(this.data.marks.map(m => [m.id, m]));
      this.internById = new Map(this.data.interns.map(i => [i.id, i]));
    },
    setting(key, d) { const s = this.data.settings.find(x => x.id === key); return s ? s.value : d; },
    async setSetting(key, value) { return this.save('settings', { id: key, value }); },

    caseOf(slot) { return slot.caseId ? this.caseById.get(slot.caseId) : this.caseByName.get(slot.name); },
    nameOf(slot) { const c = this.caseOf(slot); return c ? c.name : slot.name; },

    activeOn(slot, date) {
      if (slot.day !== weekday(date)) return false;
      if (slot.only && slot.only.length) return slot.only.includes(date);
      if (slot.start && date < slot.start) return false;
      if (slot.end && date > slot.end) return false;
      return true;
    },
    slotsAt(date, time) {
      return this.data.slots.filter(s => s.time === time && this.activeOn(s, date))
        .sort((a, b) => (a.kind === 'note') - (b.kind === 'note') || (a.order || 0) - (b.order || 0));
    },
    caseCount(date, time, exceptId) {
      return this.slotsAt(date, time).filter(s => s.kind === 'case' && s.id !== exceptId).length;
    },
    // 這一天的實際狀態（合併每週預設與單日標註）
    effective(slot, date) {
      const m = this.markById.get(slot.id + '|' + date) || {};
      let status = m.status || (slot.helper ? 'helper' : 'none');
      const helper = m.status === 'helper' ? m.helper : (m.status ? '' : slot.helper || '');
      const intern = (m.intern !== undefined && m.intern !== null) ? m.intern : (slot.intern || '');
      return { status, helper, intern, eval: !!m.eval, mark: m };
    },
    async setMark(slot, date, patch) {
      const id = slot.id + '|' + date;
      const cur = Object.assign({ id, slot: slot.id, date }, this.markById.get(id) || {}, patch);
      Object.keys(cur).forEach(k => { if (cur[k] === undefined) delete cur[k]; });
      const meaningful = cur.status || cur.eval || (cur.intern !== undefined && cur.intern !== null);
      if (!meaningful) { if (this.markById.has(id)) return this.remove('marks', id); return; }
      return this.save('marks', cur);
    },
    occurrences(slot, from, to) {
      const out = [];
      for (let d = from; d <= to; d = addDays(d, 1)) if (this.activeOn(slot, d)) out.push(d);
      return out;
    },
  };

  /* ----- 年齡 ----- */
  function ageBetween(birth, today) {
    if (!birth) return null;
    const b = parse(birth), t = parse(today);
    if (t < b) return null;
    let y = t.getFullYear() - b.getFullYear(), m = t.getMonth() - b.getMonth(), d = t.getDate() - b.getDate();
    if (d < 0) { m--; d += new Date(t.getFullYear(), t.getMonth(), 0).getDate(); }
    if (m < 0) { y--; m += 12; }
    return { y, m, d };
  }
  function ageText(a, withDays) {
    if (!a) return '';
    let s = a.y ? `${a.y} 歲 ${a.m} 個月` : `${a.m} 個月`;
    if (withDays) s += ` ${a.d} 天`;
    return s;
  }
  function gestationDays(preterm) {
    const m = String(preterm || '').match(/(\d{2})\s*(?:\+\s*(\d))?/);
    if (!m) return null;
    const days = +m[1] * 7 + (+m[2] || 0);
    return days >= 140 && days < 259 ? days : null; // 20～36+6 週才算早產
  }
  function correctedAge(birth, preterm, today) {
    const g = gestationDays(preterm);
    if (!birth || !g) return null;
    return { age: ageBetween(addDays(birth, 280 - g), today), shift: 280 - g };
  }

  window.Store = Store;
  window.Util = { pad, fmt, parse, addDays, weekday, mondayOf, uid, SLOT_TIMES, endOf, THERAPISTS, PALETTE, MAX_PER_SLOT, ageBetween, ageText, correctedAge, LS };
})();
