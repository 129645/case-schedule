/* 個案排程表：畫面與操作 */
(function () {
  'use strict';
  const S = window.Store, U = window.Util;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAY = ['', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
  const DAY_S = ['', '一', '二', '三', '四', '五', '六', '日'];
  const md = d => { const x = U.parse(d); return `${x.getMonth() + 1}/${x.getDate()}`; };

  const ICON = {
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 18v-6M9 15l3-3 3 3"/></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    export: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
  };

  /* ---------- 畫面狀態 ---------- */
  const qsToday = new URLSearchParams(location.search).get('today');
  const realToday = () => qsToday || U.fmt(new Date());
  const firstWorkday = d => { const w = U.weekday(d); return w >= 6 ? U.addDays(d, 8 - w) : d; };
  const ui = {
    view: U.LS.get('cs_view', 'week'),
    date: firstWorkday(realToday()),
    filter: null,
    menuOpen: false,
  };
  const weekDates = () => { const m = U.mondayOf(ui.date); return [0, 1, 2, 3, 4].map(i => U.addDays(m, i)); };

  /* ---------- 小工具 ---------- */
  let toastTimer;
  function toast(msg, ms = 2200) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }
  async function guard(fn, okMsg) {
    if (!S.canEdit()) { toast('目前離線，只能查看，不能修改'); return false; }
    try { await fn(); if (okMsg) toast(okMsg); return true; }
    catch (e) {
      console.error(e);
      toast(e.code === 'wrong_pass' ? '密碼已變更，請重新輸入' : '儲存失敗，請檢查網路後再試一次', 3500);
      if (e.code === 'wrong_pass') { S.logout(); boot(); }
      else S.refresh().catch(() => {});
      return false;
    }
  }
  const scriptCache = {};
  function loadScript(src) {
    if (!scriptCache[src]) scriptCache[src] = new Promise((ok, bad) => {
      const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('無法載入 ' + src));
      document.head.appendChild(s);
    });
    return scriptCache[src];
  }
  window.loadScript = loadScript;
  const internOf = id => id ? S.internById.get(id) : null;
  const colorClass = id => { const i = internOf(id); return i ? 'c-' + i.color : ''; };

  /* ---------- 啟動 ---------- */
  async function boot() {
    closeSheet();
    if (S.remote) {
      if (!S.key()) return showLogin();
      if (S.loadCache()) render();
      else $('#app').innerHTML = '<div class="center-screen"><p class="muted">載入中…</p></div>';
      try { await S.refresh(); }
      catch (e) {
        if (e.code === 'wrong_pass') { S.logout(); return showLogin(); }
        if (!S.data.cases.length && !S.data.slots.length) {
          $('#app').innerHTML = '<div class="center-screen"><div class="welcome"><h1>連不上資料</h1><p>請確認網路連線後重新整理。</p><button class="btn primary" onclick="location.reload()">重新整理</button></div></div>';
          return;
        }
        toast('目前無法連線，顯示的是上次的排程');
      }
      afterLoad();
    } else {
      S.loadCache(); S.reindex();
      afterLoad();
    }
  }
  function afterLoad() {
    const empty = !S.data.slots.length && !S.data.cases.length;
    if (empty && !S.setting('started', false) && !U.LS.get('cs_started', false)) showWelcome();
    else render();
  }

  /* ---------- 密碼 ---------- */
  async function showLogin() {
    let hasPass = true;
    $('#app').innerHTML = '<div class="center-screen"><p class="muted">連線中…</p></div>';
    try { hasPass = (await S.status()).hasPass; }
    catch (e) {
      $('#app').innerHTML = '<div class="center-screen"><div class="welcome"><h1>連不上資料</h1><p>請確認網路連線後重新整理。</p><button class="btn primary" onclick="location.reload()">重新整理</button></div></div>';
      return;
    }
    $('#app').innerHTML = `
      <div class="center-screen"><form class="welcome" id="pw-form" autocomplete="on">
        <img src="icons/icon-192.png" alt="">
        <h1>${hasPass ? '輸入密碼' : '設定密碼'}</h1>
        <p>${hasPass ? '每台手機或電腦第一次開啟時需要輸入一次。' : '請設定一組只有你知道的密碼，之後每台裝置第一次開啟時都要輸入。'}</p>
        <div class="stack">
          <input type="text" name="username" value="個案排程表" autocomplete="username" class="hidden" readonly>
          <div class="field"><input class="input" type="password" id="pw1" placeholder="密碼（至少 6 個字）" autocomplete="${hasPass ? 'current-password' : 'new-password'}" required></div>
          ${hasPass ? '' : '<div class="field"><input class="input" type="password" id="pw2" placeholder="再輸入一次" autocomplete="new-password" required></div>'}
          <div class="err" id="pw-err"></div>
          <button class="btn primary" type="submit">${hasPass ? '進入' : '設定並進入'}</button>
        </div>
      </form></div>`;
    $('#pw1').focus();
    $('#pw-form').onsubmit = async ev => {
      ev.preventDefault();
      const p1 = $('#pw1').value, err = $('#pw-err');
      err.textContent = '';
      try {
        if (!hasPass) {
          if (p1.length < 6) return (err.textContent = '密碼至少要 6 個字');
          if (p1 !== $('#pw2').value) return (err.textContent = '兩次輸入的密碼不一樣');
          await S.setup(p1);
          await S.login(p1);
        } else {
          await S.login(p1);
        }
        afterLoad();
      } catch (e) {
        err.textContent = e.code === 'wrong_pass' ? '密碼不對，請再試一次' : e.code === 'locked' ? '輸錯太多次，請 15 分鐘後再試' : e.code === 'already_set' ? '密碼已經設定過了，請重新整理後輸入密碼' : '連不上資料，請檢查網路';
      }
    };
  }

  /* ---------- 歡迎畫面 ---------- */
  function showWelcome() {
    $('#app').innerHTML = `
      <div class="center-screen"><div class="welcome">
        <img src="icons/icon-192.png" alt="">
        <h1>個案排程表</h1>
        <p>要怎麼開始建立排程？</p>
        <div class="stack">
          <button class="big-choice" id="w-import"><span class="ic">${ICON.file}</span><b>從檔案匯入</b><span>用 Excel 匯入個案聯絡資訊與每週排程</span></button>
          <button class="big-choice" id="w-manual"><span class="ic">${ICON.pen}</span><b>自行輸入</b><span>從空白排程開始，在時段裡一位一位加入</span></button>
        </div>
      </div></div>`;
    $('#w-import').onclick = () => openImport('both');
    $('#w-manual').onclick = async () => { U.LS.set('cs_started', true); render(); guard(() => S.setSetting('started', true)); };
  }

  /* ---------- 主畫面 ---------- */
  function render() {
    U.LS.set('cs_started', true);
    const offline = S.remote && !S.online;
    document.body.classList.toggle('offline', offline);
    const app = $('#app');
    const dates = weekDates();
    const label = ui.view === 'week'
      ? `${U.parse(dates[0]).getFullYear()}　${md(dates[0])} – ${md(dates[4])}`
      : `${md(ui.date)}（${DAY_S[U.weekday(ui.date)]}）`;
    app.innerHTML = `
      <header class="topbar" id="topbar">
        <div class="topbar-row">
          <div class="brand"><img src="icons/icon-192.png" alt=""><span class="brand-title">個案排程表</span></div>
          <div class="period">
            <button class="icon-btn" id="prev" aria-label="${ui.view === 'week' ? '上一週' : '前一天'}">${ICON.left}</button>
            <span class="period-label num">${label}</span>
            <button class="icon-btn" id="next" aria-label="${ui.view === 'week' ? '下一週' : '後一天'}">${ICON.right}</button>
          </div>
          <button class="btn today-btn" id="today">今天</button>
          <div class="seg" role="group" aria-label="檢視方式">
            <button id="v-week" aria-pressed="${ui.view === 'week'}">週</button>
            <button id="v-day" aria-pressed="${ui.view === 'day'}">日</button>
          </div>
          <button class="icon-btn hide-sm" id="export-btn" aria-label="匯出">${ICON.export}</button>
          <div class="menu-wrap">
            <button class="icon-btn" id="menu-btn" aria-label="更多功能" aria-expanded="${ui.menuOpen}">${ICON.more}</button>
            ${ui.menuOpen ? menuHTML() : ''}
          </div>
        </div>
        <div class="sub-row" id="legend">${legendHTML(ui.view === 'week' ? dates : [ui.date])}</div>
        ${offline ? '<div class="banner">目前離線：顯示上次載入的排程，只能查看，不能修改。</div>' : ''}
        ${!S.remote ? '<div class="banner">示範模式：資料只存在這台裝置。設定好 Google 試算表後，電腦與手機就會同步。</div>' : ''}
      </header>
      <main id="main">${ui.view === 'week' ? weekHTML(dates) : dayHTML(ui.date)}</main>`;
    const tb = $('#topbar');
    document.documentElement.style.setProperty('--topbar-h', tb.offsetHeight + 'px');
    bindMain();
  }

  function menuHTML() {
    const net = S.remote ? ' class="needs-net"' : '';
    return `<div class="menu" role="menu">
      <button data-m="export" role="menuitem">匯出這週（Word／PDF）</button>
      <hr>
      <button data-m="roster" role="menuitem">個案名冊</button>
      <button data-m="interns" role="menuitem"${net}>實習生與顏色</button>
      <button data-m="memo" role="menuitem">常用備忘</button>
      <hr>
      <button data-m="import-contacts" role="menuitem"${net}>匯入個案聯絡資訊</button>
      <button data-m="import-schedule" role="menuitem"${net}>匯入排程表</button>
      <button data-m="backup" role="menuitem">備份全部資料（Excel）</button>
      <button data-m="restore" role="menuitem"${net}>從備份還原</button>
      ${S.remote ? '<hr><button data-m="refresh" role="menuitem">重新載入資料</button><button data-m="password" role="menuitem" class="needs-net">變更密碼</button><button data-m="logout" role="menuitem">登出這台裝置</button>' : ''}
    </div>`;
  }

  function legendHTML(dates) {
    const counts = new Map(); let self = 0, total = 0;
    for (const d of dates) for (const s of S.data.slots) {
      if (s.kind !== 'case' || !S.activeOn(s, d)) continue;
      const e = S.effective(s, d); total++;
      if (e.intern && internOf(e.intern)) counts.set(e.intern, (counts.get(e.intern) || 0) + 1); else self++;
    }
    const chip = (key, label, n, sw) => `<button class="legend-chip" data-filter="${esc(key)}" aria-pressed="${ui.filter === key}">${sw ? `<span class="sw ${sw}"></span>` : ''}${esc(label)} <b class="num">${n}</b></button>`;
    let html = chip('', '全部', total, '');
    html += chip('__self', '自己', self, '');
    for (const i of S.data.interns) html += chip(i.id, i.name, counts.get(i.id) || 0, 'c-' + i.color);
    const sync = S.remote && S.lastSync ? `<span class="sync-note"><span class="hide-sm">更新於 ${new Date(S.lastSync).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}</span><button class="icon-btn" id="refresh-btn" aria-label="重新載入" style="width:30px;height:30px;vertical-align:middle">${ICON.refresh}</button></span>` : '';
    return html + sync;
  }

  function dimmed(e) {
    if (!ui.filter) return false;
    if (ui.filter === '__self') return !!(e.intern && internOf(e.intern));
    return e.intern !== ui.filter;
  }

  function badges(s, e, short) {
    let b = '';
    if (e.status === 'parent') b += `<span class="bd leave">${short ? '假' : '已請假'}</span>`;
    if (e.status === 'self') b += `<span class="bd leave">個假</span>`;
    if (e.status === 'helper' && e.helper) b += `<span class="bd help">${esc(e.helper[0])}</span>`;
    if (e.eval) b += '<span class="bd eval">評</span>';
    if (s.only && s.only.length) b += '<span class="bd once">臨</span>';
    if (s.note) b += '<span class="bd memo">備</span>';
    return b;
  }

  function chipHTML(s, d) {
    if (s.kind === 'note') return `<button class="note-chip" data-note="${esc(s.id)}" data-date="${d}">${esc(s.text)}</button>`;
    const e = S.effective(s, d);
    const cls = ['chip'];
    const cc = colorClass(e.intern);
    if (cc) cls.push('tinted', cc);
    if (e.status === 'parent' || e.status === 'self') cls.push('off');
    if (dimmed(e)) cls.push('dim');
    const name = S.nameOf(s);
    const title = [name, s.note, e.status === 'helper' && e.helper ? '由' + e.helper + '協助' : ''].filter(Boolean).join('・');
    return `<button class="${cls.join(' ')}" data-slot="${esc(s.id)}" data-date="${d}" title="${esc(title)}"><span class="nm">${esc(name)}</span>${badges(s, e, true)}</button>`;
  }

  function weekHTML(dates) {
    const today = realToday();
    let html = '<div class="week-scroll"><div class="week" role="grid"><div class="hd corner"></div>';
    dates.forEach((d, i) => {
      html += `<div class="hd ${d === today ? 'is-today' : ''}" data-goday="${d}" role="columnheader"><div class="dname">${DAY[i + 1]}</div><div class="ddate num">${md(d)}</div></div>`;
    });
    U.SLOT_TIMES.forEach(t => {
      if (t === '13:30') html += '<div class="lunch">午休 12:00 – 13:30</div>';
      html += `<div class="tm num">${t}</div>`;
      dates.forEach(d => {
        const list = S.slotsAt(d, t);
        const n = list.filter(s => s.kind === 'case').length;
        html += `<div class="cell ${d === today ? 'is-today' : ''} ${n >= U.MAX_PER_SLOT ? 'full' : ''} ${list.length ? '' : 'empty'}" role="gridcell">`;
        list.forEach(s => { html += chipHTML(s, d); });
        if (n < U.MAX_PER_SLOT) html += `<button class="add" data-add="${d}|${t}" aria-label="新增到 ${DAY[U.weekday(d)]} ${t}">＋</button>`;
        html += '</div>';
      });
    });
    return html + '</div></div>';
  }

  function dayHTML(d) {
    const today = realToday();
    const now = new Date(); const nowT = U.pad(now.getHours()) + ':' + U.pad(now.getMinutes());
    let count = 0;
    let rows = '';
    U.SLOT_TIMES.forEach(t => {
      if (t === '13:30') rows += '<div class="day-lunch">午休 12:00 – 13:30</div>';
      const list = S.slotsAt(d, t);
      const cases = list.filter(s => s.kind === 'case');
      count += cases.length;
      const isNow = d === today && nowT >= t && nowT < U.endOf(t);
      let items = list.map(s => s.kind === 'note' ? `<button class="card" data-note="${esc(s.id)}" data-date="${d}"><span class="bar"></span><span class="main"><span class="meta">私人註記</span><div class="nm" style="font-weight:500">${esc(s.text)}</div></span></button>` : cardHTML(s, d)).join('');
      if (cases.length < U.MAX_PER_SLOT) items += `<button class="day-add" data-add="${d}|${t}">＋ 新增</button>`;
      rows += `<div class="day-row ${isNow ? 'now' : ''}"><div class="t num">${t}<small>${U.endOf(t)}</small></div><div class="items">${items}</div></div>`;
    });
    const x = U.parse(d);
    return `<div class="day-head"><h1 class="num">${x.getMonth() + 1}月${x.getDate()}日</h1><span class="wd">${DAY[U.weekday(d)]}${d === today ? '・今天' : ''}</span><span class="count">${count} 位個案</span></div>
      <div class="day-list">${rows}</div>`;
  }

  function cardHTML(s, d) {
    const e = S.effective(s, d);
    const c = S.caseOf(s);
    const age = c && c.birthday ? U.ageText(U.ageBetween(c.birthday, d)) : '';
    const intern = internOf(e.intern);
    const tags = [];
    if (e.status === 'parent') tags.push('<span class="tag leave">已向家長請假</span>');
    if (e.status === 'self') tags.push('<span class="tag leave">個案自己請假</span>');
    if (e.status === 'helper' && e.helper) tags.push(`<span class="tag help">由${esc(e.helper)}協助</span>`);
    if (e.eval) tags.push('<span class="tag eval">需評估</span>');
    if (intern) tags.push(`<span class="tag ${'c-' + intern.color}">${esc(intern.name)}</span>`);
    if (s.only && s.only.length) tags.push('<span class="tag once">只有特定日期</span>');
    if (s.note) tags.push(`<span class="tag">${esc(s.note)}</span>`);
    const off = e.status === 'parent' || e.status === 'self';
    return `<button class="card ${off ? 'off' : ''} ${dimmed(e) ? 'chip dim' : ''}" data-slot="${esc(s.id)}" data-date="${d}" style="${dimmed(e) ? 'opacity:.3' : ''}">
      <span class="bar ${intern ? 'c-' + intern.color : ''}"></span>
      <span class="main"><div class="nm">${esc(S.nameOf(s))}</div><div class="meta">${age || (c ? '未填生日' : '找不到聯絡資料')}</div>${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}</span>
    </button>`;
  }

  function bindMain() {
    $('#prev').onclick = () => { ui.date = ui.view === 'week' ? U.addDays(U.mondayOf(ui.date), -7) : prevWorkday(ui.date); render(); };
    $('#next').onclick = () => { ui.date = ui.view === 'week' ? U.addDays(U.mondayOf(ui.date), 7) : nextWorkday(ui.date); render(); };
    $('#today').onclick = () => { ui.date = firstWorkday(realToday()); render(); };
    $('#v-week').onclick = () => { ui.view = 'week'; U.LS.set('cs_view', 'week'); render(); };
    $('#v-day').onclick = () => {
      ui.view = 'day'; U.LS.set('cs_view', 'day');
      const t = firstWorkday(realToday());
      if (U.mondayOf(t) === U.mondayOf(ui.date)) ui.date = t;
      render();
    };
    $('#export-btn').onclick = openExport;
    $('#menu-btn').onclick = e => { e.stopPropagation(); ui.menuOpen = !ui.menuOpen; render(); };
    $$('.menu [data-m]').forEach(b => b.onclick = () => { ui.menuOpen = false; render(); menuAction(b.dataset.m); });
    $$('[data-filter]').forEach(b => b.onclick = () => { const k = b.dataset.filter || null; ui.filter = ui.filter === k ? null : k; render(); });
    const rb = $('#refresh-btn'); if (rb) rb.onclick = doRefresh;
    $$('[data-goday]').forEach(h => h.onclick = () => { ui.view = 'day'; ui.date = h.dataset.goday; U.LS.set('cs_view', 'day'); render(); window.scrollTo(0, 0); });
    $$('[data-slot]').forEach(b => b.onclick = () => openCase(b.dataset.slot, b.dataset.date));
    $$('[data-note]').forEach(b => b.onclick = () => openNote(b.dataset.note, b.dataset.date));
    $$('[data-add]').forEach(b => b.onclick = () => { const [d, t] = b.dataset.add.split('|'); openAdd(d, t); });
  }
  const prevWorkday = d => { let x = U.addDays(d, -1); while (U.weekday(x) > 5) x = U.addDays(x, -1); return x; };
  const nextWorkday = d => { let x = U.addDays(d, 1); while (U.weekday(x) > 5) x = U.addDays(x, 1); return x; };
  document.addEventListener('click', () => { if (ui.menuOpen) { ui.menuOpen = false; render(); } });

  async function doRefresh() {
    try { await S.refresh(); toast('已更新為最新資料'); } catch (e) { toast('無法連線，請檢查網路'); }
  }

  function menuAction(m) {
    if (m === 'export') return openExport();
    if (m === 'roster') return openRoster();
    if (m === 'interns') return openInterns();
    if (m === 'memo') return openMemo();
    if (m === 'import-contacts') return openImport('contacts');
    if (m === 'import-schedule') return openImport('schedule');
    if (m === 'backup') return window.Exporter.backup().then(() => toast('備份檔已下載')).catch(e => toast(e.message));
    if (m === 'restore') return openRestore();
    if (m === 'refresh') return doRefresh();
    if (m === 'password') return openPassword();
    if (m === 'logout') { S.logout(); location.reload(); }
  }

  /* ---------- 對話框基本框架 ---------- */
  let sheetOnClose = null;
  function openSheet({ title, sub = '', body = '', foot = '', wide = false, tabs = null, onClose = null }) {
    sheetOnClose = onClose;
    $('#sheet-root').innerHTML = `
      <div class="overlay" id="overlay">
        <div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
          <div class="sheet-hd"><div><h2 id="sheet-title">${title}</h2>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
            <button class="icon-btn" id="sheet-close" aria-label="關閉">${ICON.close}</button></div>
          ${tabs ? `<div class="tabs" role="tablist">${tabs.map((t, i) => `<button role="tab" data-tab="${i}" aria-selected="${i === 0}">${t}</button>`).join('')}</div>` : ''}
          <div class="sheet-body" id="sheet-body">${body}</div>
          ${foot ? `<div class="sheet-ft" id="sheet-ft">${foot}</div>` : ''}
        </div>
      </div>`;
    $('#overlay').addEventListener('click', e => { if (e.target.id === 'overlay') closeSheet(); });
    $('#sheet-close').onclick = closeSheet;
    document.addEventListener('keydown', escClose);
    return $('#sheet-root');
  }
  function escClose(e) { if (e.key === 'Escape') closeSheet(); }
  function closeSheet() {
    const r = $('#sheet-root'); if (r && r.innerHTML) { r.innerHTML = ''; document.removeEventListener('keydown', escClose); if (sheetOnClose) { const f = sheetOnClose; sheetOnClose = null; f(); } }
  }
  const optHTML = (val, label, checked, extra = '') => `<button class="opt" role="radio" data-val="${esc(val)}" aria-checked="${!!checked}">${extra || '<span class="dot"></span>'}<span>${label}</span></button>`;

  /* ---------- 點個案名字後的對話框 ---------- */
  function openCase(slotId, date, tab = 0) {
    const s = S.data.slots.find(x => x.id === slotId);
    if (!s) return;
    const name = S.nameOf(s);
    openSheet({
      title: esc(name),
      sub: `${DAY[U.weekday(date)]} ${md(date)}　${s.time} – ${U.endOf(s.time)}`,
      tabs: ['個案資訊', '請假・評估', '分派實習生', '更動'],
      onClose: render,
    });
    const paint = i => {
      $$('.tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab == i));
      const body = $('#sheet-body');
      const fresh = S.data.slots.find(x => x.id === slotId);
      if (!fresh) { closeSheet(); return; }
      [caseInfoTab, leaveTab, internTab, changeTab][i](body, fresh, date, () => paint(i));
    };
    $$('.tabs [data-tab]').forEach(b => b.onclick = () => paint(+b.dataset.tab));
    paint(tab);
  }

  function caseInfoTab(body, s, date) {
    const c = S.caseOf(s);
    const today = realToday();
    if (!c) {
      const sugg = Importer.suggest(s.name, S.data.cases.map(x => x.name));
      body.innerHTML = `<div class="report"><b>找不到「${esc(s.name)}」的聯絡資料</b><div class="small muted" style="margin-top:4px">可能是名字打錯，或還沒匯入。</div></div>
        ${sugg.length ? `<div class="section-label">可能是這位？</div><div class="options">${sugg.map(n => `<button class="opt needs-net" data-link="${esc(n)}"><span class="dot"></span><span>對應到「${esc(n)}」</span></button>`).join('')}</div>` : ''}
        <div class="section-label">或</div>
        <div class="row"><button class="btn needs-net" id="pick-case">從名冊選擇</button><button class="btn primary needs-net" id="new-case">新增聯絡資料</button></div>
        ${s.note ? `<div class="section-label">備註</div><div>${esc(s.note)}</div>` : ''}`;
      $$('[data-link]', body).forEach(b => b.onclick = () => linkSlotTo(s, b.dataset.link, date));
      $('#pick-case', body).onclick = () => openRoster(n => linkSlotTo(s, n, date), date, s.id);
      $('#new-case', body).onclick = () => openCaseEdit(null, { name: s.name }, () => openCase(s.id, date));
      return;
    }
    const a = U.ageBetween(c.birthday, today);
    const ca = U.correctedAge(c.birthday, c.preterm, today);
    const tel = p => {
      if (!p) return '';
      const num = (String(p).match(/[\d\-]{6,}/) || [''])[0].replace(/-/g, '');
      return num.length >= 8 ? `<a href="tel:${num}">${esc(p)}</a>` : esc(p);
    };
    const weekly = S.data.slots.filter(x => x.kind === 'case' && S.caseOf(x) === c)
      .sort((x, y) => x.day - y.day || x.time.localeCompare(y.time))
      .map(x => `${DAY[x.day]} ${x.time}${x.only ? `（只有 ${x.only.map(md).join('、')}）` : ''}${x.start ? `（${md(x.start)} 起）` : ''}`);
    body.innerHTML = `
      <dl class="info-grid">
        <dt>生日</dt><dd class="num">${c.birthday ? c.birthday.replace(/-/g, '/') : '<span class="muted">未填</span>'}</dd>
        <dt>目前年齡</dt><dd>${a ? U.ageText(a, true) : '<span class="muted">—</span>'}</dd>
        ${c.preterm ? `<dt>早產</dt><dd>${esc(c.preterm)} 週</dd>` : ''}
        ${ca ? `<dt>矯正年齡</dt><dd>${U.ageText(ca.age, true)}<div class="hint">依 40 週足月計算，少算 ${ca.shift} 天</div></dd>` : ''}
        <dt>聯絡電話</dt><dd>${tel(c.phone) || '<span class="muted">未填</span>'}</dd>
        ${c.phone2 ? `<dt>電話 2</dt><dd>${c.phone2.split(' / ').map(tel).join('<br>')}</dd>` : ''}
        ${c.note ? `<dt>個案備註</dt><dd>${esc(c.note)}</dd>` : ''}
        ${s.note ? `<dt>這個時段</dt><dd>${esc(s.note)}</dd>` : ''}
        <dt>上課時段</dt><dd>${weekly.map(esc).join('<br>')}</dd>
      </dl>
      <div class="row" style="margin-top:18px"><button class="btn needs-net" id="edit-case">編輯聯絡資料</button></div>`;
    $('#edit-case', body).onclick = () => openCaseEdit(c, null, () => openCase(s.id, date));
  }

  async function linkSlotTo(s, caseName, date) {
    const c = S.caseByName.get(caseName);
    if (!c) return;
    await guard(() => S.save('slots', Object.assign({}, s, { caseId: c.id, name: c.name })), `已對應到「${c.name}」`);
    openCase(s.id, date);
  }

  function leaveTab(body, s, date, repaint) {
    const e = S.effective(s, date);
    const opts = [['none', '正常上課'], ['parent', '已向家長請假'], ['self', '個案自己請假']]
      .concat(U.THERAPISTS.map(n => ['helper:' + n, `請${n}協助`]));
    const cur = e.status === 'helper' ? 'helper:' + e.helper : e.status;
    const maxDate = U.addDays(date, 120);
    body.innerHTML = `
      <div class="section-label">${md(date)}（${DAY_S[U.weekday(date)]}）這一天</div>
      <div class="options" role="radiogroup" id="st-opts">${opts.map(([v, l]) => optHTML(v, l, v === cur)).join('')}</div>
      ${s.helper ? `<div class="hint" style="margin-top:6px">每週固定由${esc(s.helper)}協助（可在「更動」修改）</div>` : ''}
      <div class="section-label">套用範圍</div>
      <div class="row">
        <div class="seg" role="group"><button id="rg-one" aria-pressed="true">只有這天</button><button id="rg-range" aria-pressed="false">一段日期</button></div>
        <input class="input hidden num" type="date" id="rg-to" min="${date}" max="${maxDate}" value="${U.addDays(date, 7)}" style="width:auto;min-height:40px" aria-label="到哪一天為止">
      </div>
      <div class="hint" id="rg-hint" style="margin-top:6px"></div>
      <div class="section-label">評估</div>
      <div class="switch-row"><span>這次需要做評估</span><button class="switch needs-net" role="switch" id="eval-sw" aria-checked="${e.eval}" aria-label="需評估"></button></div>`;
    let range = false;
    const toEl = $('#rg-to', body);
    const hint = () => {
      const h = $('#rg-hint', body);
      if (!range) { h.textContent = ''; return; }
      const occ = S.occurrences(s, date, toEl.value || date);
      h.textContent = occ.length ? `會套用到 ${occ.length} 次：${occ.map(md).join('、')}` : '這段日期沒有這個時段';
    };
    $('#rg-one', body).onclick = () => { range = false; $('#rg-one', body).setAttribute('aria-pressed', true); $('#rg-range', body).setAttribute('aria-pressed', false); toEl.classList.add('hidden'); hint(); };
    $('#rg-range', body).onclick = () => { range = true; $('#rg-range', body).setAttribute('aria-pressed', true); $('#rg-one', body).setAttribute('aria-pressed', false); toEl.classList.remove('hidden'); hint(); };
    toEl.oninput = hint;
    $$('#st-opts .opt', body).forEach(b => {
      b.classList.add('needs-net');
      b.onclick = async () => {
        const v = b.dataset.val;
        const patch = v.startsWith('helper:') ? { status: 'helper', helper: v.slice(7) } : { status: v, helper: undefined };
        if (v === 'none' && !s.helper) patch.status = undefined;
        const dates = range ? S.occurrences(s, date, toEl.value || date) : [date];
        const ok = await guard(async () => { for (const d of dates) await S.setMark(s, d, patch); },
          dates.length > 1 ? `已套用到 ${dates.length} 次` : '已儲存');
        if (ok) repaint();
      };
    });
    $('#eval-sw', body).onclick = async () => {
      const ok = await guard(() => S.setMark(s, date, { eval: !e.eval || undefined }), !e.eval ? '已標註需評估' : '已取消評估');
      if (ok) repaint();
    };
  }

  function internTab(body, s, date, repaint) {
    const e = S.effective(s, date);
    if (!S.data.interns.length) {
      body.innerHTML = `<div class="report">還沒有實習生。先新增實習生並選一個顏色，就可以分派個案。</div><div class="row" style="margin-top:14px"><button class="btn primary needs-net" id="go-interns">新增實習生</button></div>`;
      $('#go-interns', body).onclick = () => openInterns(() => openCase(s.id, date, 2));
      return;
    }
    const weeklyIntern = s.intern || '';
    const hasOverride = S.markById.has(s.id + '|' + date) && S.markById.get(s.id + '|' + date).intern != null;
    body.innerHTML = `
      <div class="section-label">分派給</div>
      <div class="options" role="radiogroup" id="in-opts">
        ${optHTML('', '自己做（不分派）', !e.intern, '<span class="sw"></span>')}
        ${S.data.interns.map(i => optHTML(i.id, esc(i.name), e.intern === i.id, `<span class="sw c-${i.color}"></span>`)).join('')}
      </div>
      <div class="section-label">套用範圍</div>
      <div class="seg" role="group"><button id="sc-once" aria-pressed="false">只有這次</button><button id="sc-weekly" aria-pressed="true">每週都是</button></div>
      <div class="hint" style="margin-top:8px">目前每週固定：${weeklyIntern && internOf(weeklyIntern) ? esc(internOf(weeklyIntern).name) : '自己做'}${hasOverride ? `；${md(date)} 這次另外指定` : ''}</div>`;
    let weekly = true;
    $('#sc-once', body).onclick = () => { weekly = false; $('#sc-once', body).setAttribute('aria-pressed', true); $('#sc-weekly', body).setAttribute('aria-pressed', false); };
    $('#sc-weekly', body).onclick = () => { weekly = true; $('#sc-weekly', body).setAttribute('aria-pressed', true); $('#sc-once', body).setAttribute('aria-pressed', false); };
    $$('#in-opts .opt', body).forEach(b => {
      b.classList.add('needs-net');
      b.onclick = async () => {
        const v = b.dataset.val;
        const nm = v ? internOf(v).name : '自己';
        const ok = await guard(async () => {
          if (weekly) {
            await S.save('slots', Object.assign({}, s, { intern: v }));
            if (hasOverride) await S.setMark(s, date, { intern: undefined });
          } else {
            await S.setMark(s, date, { intern: v === weeklyIntern ? undefined : v });
          }
        }, weekly ? `每週都由${nm === '自己' ? '自己做' : nm + '負責'}` : `${md(date)} 由${nm === '自己' ? '自己做' : nm + '負責'}`);
        if (ok) repaint();
      };
    });
  }

  function changeTab(body, s, date, repaint) {
    const dayOpts = [1, 2, 3, 4, 5].map(d => `<option value="${d}" ${d === s.day ? 'selected' : ''}>${DAY[d]}</option>`).join('');
    const timeOpts = U.SLOT_TIMES.map(t => `<option ${t === s.time ? 'selected' : ''}>${t}</option>`).join('');
    const helperOpts = ['', ...U.THERAPISTS].map(n => `<option value="${n}" ${n === (s.helper || '') ? 'selected' : ''}>${n || '無'}</option>`).join('');
    const kind = s.only && s.only.length ? `只有特定日期：${s.only.map(md).join('、')}` : s.start ? `${md(s.start)} 起每週` : '每週固定';
    body.innerHTML = `
      <div class="section-label">移到別的時段（每週）</div>
      <div class="row"><select class="input" id="mv-day" style="flex:1">${dayOpts}</select><select class="input num" id="mv-time" style="flex:1">${timeOpts}</select><button class="btn needs-net" id="mv-go">移動</button></div>
      <div class="err" id="mv-err"></div>
      <div class="field"><label for="nt">這個時段的備註（例如：筆剪釦、平衡）</label><input class="input" id="nt" value="${esc(s.note || '')}"></div>
      <div class="field"><label for="hp">每週固定協助的治療師</label><select class="input" id="hp">${helperOpts}</select></div>
      <div class="field"><label>上課頻率</label><div>${esc(kind)}</div></div>
      <div class="row"><button class="btn primary needs-net" id="ch-save">儲存</button></div>
      <div class="section-label">移除</div>
      <div class="row" id="rm-row"><button class="btn danger needs-net" id="rm">從排程移除</button></div>`;
    $('#mv-go', body).onclick = async () => {
      const day = +$('#mv-day', body).value, time = $('#mv-time', body).value;
      if (day === s.day && time === s.time) return;
      const target = U.addDays(U.mondayOf(date), day - 1);
      if (S.caseCount(target, time, s.id) >= U.MAX_PER_SLOT) { $('#mv-err', body).textContent = `${DAY[day]} ${time} 已經有 6 位個案，無法再加入`; return; }
      // 該時段原本的單日標註不再適用，一併移除
      const old = S.data.marks.filter(m => m.slot === s.id).map(m => m.id);
      const ok = await guard(async () => {
        await S.save('slots', Object.assign({}, s, { day, time, only: s.only && s.only.length ? null : s.only }));
        if (old.length) await S.remove('marks', old);
      }, `已移到${DAY[day]} ${time}`);
      if (ok) { closeSheet(); }
    };
    $('#ch-save', body).onclick = async () => {
      const ok = await guard(() => S.save('slots', Object.assign({}, s, { note: $('#nt', body).value.trim(), helper: $('#hp', body).value })), '已儲存');
      if (ok) repaint();
    };
    $('#rm', body).onclick = () => {
      $('#rm-row', body).innerHTML = `<span class="small">確定要把「${esc(S.nameOf(s))}」從${DAY[s.day]} ${s.time} 移除嗎？</span><button class="btn danger needs-net" id="rm-yes">移除</button><button class="btn ghost" id="rm-no">取消</button>`;
      $('#rm-no', body).onclick = repaint;
      $('#rm-yes', body).onclick = async () => {
        const marks = S.data.marks.filter(m => m.slot === s.id).map(m => m.id);
        const ok = await guard(async () => { await S.remove('slots', s.id); if (marks.length) await S.remove('marks', marks); }, '已移除');
        if (ok) closeSheet();
      };
    };
  }

  /* ---------- 新增到時段 ---------- */
  function openAdd(date, time) {
    if (!S.canEdit()) return toast('目前離線，只能查看，不能修改');
    const n = S.caseCount(date, time);
    openSheet({
      title: '新增到時段',
      sub: `${DAY[U.weekday(date)]} ${md(date)}　${time} – ${U.endOf(time)}　（已有 ${n} 位）`,
      body: `
        <div class="seg" role="group" style="margin-bottom:16px"><button id="k-case" aria-pressed="true">個案</button><button id="k-note" aria-pressed="false">私人註記</button></div>
        <div id="add-case">
          <div class="field"><label for="a-name">個案姓名</label><input class="input" id="a-name" list="case-names" autocomplete="off" placeholder="輸入姓名，可從名冊挑選"><datalist id="case-names">${S.data.cases.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist></div>
          <div class="field"><label for="a-note">備註（選填）</label><input class="input" id="a-note" placeholder="例如：筆剪釦"></div>
          <div class="field"><label>頻率</label>
            <div class="seg" role="group"><button id="f-weekly" aria-pressed="true">每週${DAY_S[U.weekday(date)]}</button><button id="f-once" aria-pressed="false">只有 ${md(date)}</button></div></div>
        </div>
        <div id="add-note" class="hidden">
          <div class="field"><label for="a-text">註記內容（不佔個案名額）</label><input class="input" id="a-text" placeholder="例如：禮拜、小廚師團體"></div>
          <div class="hint">私人註記每週都會顯示在這個時段。</div>
        </div>
        <div class="err" id="a-err"></div>`,
      foot: '<button class="btn ghost" id="a-cancel">取消</button><button class="btn primary" id="a-save">加入</button>',
      onClose: render,
    });
    let kind = 'case', weekly = true;
    const setSeg = (a, b, on) => { $(a).setAttribute('aria-pressed', on); $(b).setAttribute('aria-pressed', !on); };
    $('#k-case').onclick = () => { kind = 'case'; setSeg('#k-case', '#k-note', true); $('#add-case').classList.remove('hidden'); $('#add-note').classList.add('hidden'); };
    $('#k-note').onclick = () => { kind = 'note'; setSeg('#k-case', '#k-note', false); $('#add-case').classList.add('hidden'); $('#add-note').classList.remove('hidden'); $('#a-text').focus(); };
    $('#f-weekly').onclick = () => { weekly = true; setSeg('#f-weekly', '#f-once', true); };
    $('#f-once').onclick = () => { weekly = false; setSeg('#f-weekly', '#f-once', false); };
    $('#a-cancel').onclick = closeSheet;
    $('#a-name').focus();
    $('#a-save').onclick = async () => {
      const err = $('#a-err');
      const day = U.weekday(date);
      const order = Date.now();
      if (kind === 'note') {
        const text = $('#a-text').value.trim();
        if (!text) return (err.textContent = '請輸入註記內容');
        const ok = await guard(() => S.save('slots', { id: U.uid('s'), kind: 'note', day, time, text, order }), '已加入註記');
        if (ok) closeSheet();
        return;
      }
      const name = $('#a-name').value.trim().replace(/\s+/g, '');
      if (!name) return (err.textContent = '請輸入個案姓名');
      if (S.caseCount(date, time) >= U.MAX_PER_SLOT) return (err.textContent = '這個時段已經有 6 位個案，無法再加入');
      if (weekly) {
        // 每週新增時，檢查未來 8 週有沒有任何一天會超過 6 位
        for (let i = 0; i < 8; i++) {
          const d = U.addDays(date, 7 * i);
          if (S.caseCount(d, time) >= U.MAX_PER_SLOT) return (err.textContent = `${md(d)} 這個時段已經有 6 位個案，請改成「只有 ${md(date)}」或換時段`);
        }
      }
      const c = S.caseByName.get(name);
      const slot = {
        id: U.uid('s'), kind: 'case', day, time, name, caseId: c ? c.id : null, note: $('#a-note').value.trim(),
        helper: '', intern: '', only: weekly ? null : [date], start: weekly ? null : null, end: null, order,
      };
      const ok = await guard(() => S.save('slots', slot), c ? `已加入「${name}」` : `已加入「${name}」，名冊裡還沒有這位的聯絡資料`);
      if (ok) closeSheet();
    };
  }

  /* ---------- 私人註記 ---------- */
  function openNote(id, date) {
    const s = S.data.slots.find(x => x.id === id);
    if (!s) return;
    openSheet({
      title: '私人註記', sub: `${DAY[s.day]} ${s.time}　每週顯示，不佔個案名額`,
      body: `<div class="field"><label for="n-text">內容</label><input class="input" id="n-text" value="${esc(s.text)}"></div>`,
      foot: '<button class="btn danger needs-net" id="n-del" style="margin-right:auto">刪除</button><button class="btn primary needs-net" id="n-save">儲存</button>',
      onClose: render,
    });
    $('#n-save').onclick = async () => { const ok = await guard(() => S.save('slots', Object.assign({}, s, { text: $('#n-text').value.trim() || s.text })), '已儲存'); if (ok) closeSheet(); };
    $('#n-del').onclick = async () => { const ok = await guard(() => S.remove('slots', s.id), '已刪除註記'); if (ok) closeSheet(); };
  }

  /* ---------- 實習生 ---------- */
  function openInterns(after) {
    const draw = () => {
      const used = new Set(S.data.interns.map(i => i.color));
      const free = U.PALETTE.find(p => !used.has(p.key)) || U.PALETTE[0];
      openSheet({
        title: '實習生與顏色', sub: '分派給實習生的個案會顯示他的顏色',
        body: `
          <div class="list" id="in-list">${S.data.interns.length ? S.data.interns.map(i => `
            <div data-id="${esc(i.id)}"><span class="sw c-${i.color}" style="width:22px;height:22px;border-radius:6px;flex:none"></span>
              <input class="input" value="${esc(i.name)}" data-rename style="min-height:38px">
              <select class="input" data-color style="width:auto;min-height:38px">${U.PALETTE.map(p => `<option value="${p.key}" ${p.key === i.color ? 'selected' : ''}>${p.name}</option>`).join('')}</select>
              <button class="icon-btn needs-net" data-del aria-label="刪除 ${esc(i.name)}">${ICON.close}</button></div>`).join('') : '<div class="muted">還沒有實習生</div>'}</div>
          <div class="section-label">新增實習生</div>
          <div class="row"><input class="input" id="in-name" placeholder="實習生姓名" style="flex:2;min-width:140px">
            <select class="input" id="in-color" style="flex:1;min-width:120px">${U.PALETTE.map(p => `<option value="${p.key}" ${p.key === free.key ? 'selected' : ''}>${p.name}</option>`).join('')}</select>
            <button class="btn primary needs-net" id="in-add">新增</button></div>
          <div class="err" id="in-err"></div>`,
        onClose: after || render,
      });
      $('#in-add').onclick = async () => {
        const name = $('#in-name').value.trim();
        if (!name) return ($('#in-err').textContent = '請輸入姓名');
        const ok = await guard(() => S.save('interns', { id: U.uid('i'), name, color: $('#in-color').value }), `已新增 ${name}`);
        if (ok) { sheetOnClose = null; draw(); }
      };
      $$('#in-list [data-id]').forEach(row => {
        const id = row.dataset.id, it = S.internById.get(id);
        $('[data-rename]', row).onchange = e => guard(() => S.save('interns', Object.assign({}, it, { name: e.target.value.trim() || it.name })), '已改名');
        $('[data-color]', row).onchange = async e => { const ok = await guard(() => S.save('interns', Object.assign({}, it, { color: e.target.value })), '已換顏色'); if (ok) { sheetOnClose = null; draw(); } };
        $('[data-del]', row).onclick = async () => {
          const ok = await guard(async () => {
            await S.remove('interns', id);
            const sl = S.data.slots.filter(s => s.intern === id).map(s => Object.assign({}, s, { intern: '' }));
            if (sl.length) await S.save('slots', sl);
            const mk = S.data.marks.filter(m => m.intern === id).map(m => Object.assign({}, m, { intern: undefined }));
            for (const m of mk) { const sl2 = S.data.slots.find(x => x.id === m.slot); if (sl2) await S.setMark(sl2, m.date, { intern: undefined }); }
          }, `已刪除 ${it.name}，他的個案改回自己做`);
          if (ok) { sheetOnClose = null; draw(); }
        };
      });
    };
    draw();
  }

  /* ---------- 個案名冊 ---------- */
  function openRoster(pick, date, slotId) {
    const draw = (q = '') => {
      const list = S.data.cases.filter(c => !q || c.name.includes(q) || (c.phone || '').includes(q)).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
      $('#roster-list').innerHTML = list.map(c => {
        const a = U.ageBetween(c.birthday, realToday());
        return `<button class="item" data-name="${esc(c.name)}"><b style="min-width:4.5em">${esc(c.name)}</b><span class="small muted">${a ? U.ageText(a) : '未填生日'}${c.phone ? '・' + esc(c.phone) : ''}</span></button>`;
      }).join('') || '<div class="muted">找不到符合的個案</div>';
      $$('#roster-list [data-name]').forEach(b => b.onclick = () => {
        if (pick) { closeSheet(); pick(b.dataset.name); }
        else openCaseEdit(S.caseByName.get(b.dataset.name), null, () => openRoster());
      });
    };
    openSheet({
      title: pick ? '選擇個案' : '個案名冊', sub: `共 ${S.data.cases.length} 位`,
      body: `<div class="search"><input class="input" id="roster-q" placeholder="搜尋姓名或電話" type="search"></div><div class="list" id="roster-list"></div>`,
      foot: pick ? '' : '<button class="btn primary needs-net" id="roster-new">新增個案</button>',
      onClose: pick ? () => openCase(slotId, date) : render,
    });
    $('#roster-q').oninput = e => draw(e.target.value.trim());
    if (!pick) $('#roster-new').onclick = () => openCaseEdit(null, {}, () => openRoster());
    draw();
  }

  function openCaseEdit(c, preset, back) {
    const v = c || Object.assign({ name: '', birthday: '', preterm: '', phone: '', phone2: '', note: '' }, preset || {});
    openSheet({
      title: c ? '編輯聯絡資料' : '新增個案',
      body: `
        <div class="field"><label for="e-name">姓名</label><input class="input" id="e-name" value="${esc(v.name)}"></div>
        <div class="row"><div class="field"><label for="e-bd">生日</label><input class="input num" type="date" id="e-bd" value="${esc(v.birthday || '')}"></div>
          <div class="field"><label for="e-pt">早產週數（例如 28+4，足月免填）</label><input class="input" id="e-pt" value="${esc(v.preterm || '')}"></div></div>
        <div class="row"><div class="field"><label for="e-ph">聯絡電話</label><input class="input" type="tel" id="e-ph" value="${esc(v.phone || '')}"></div>
          <div class="field"><label for="e-ph2">電話 2</label><input class="input" id="e-ph2" value="${esc(v.phone2 || '')}"></div></div>
        <div class="field"><label for="e-note">個案備註</label><input class="input" id="e-note" value="${esc(v.note || '')}"></div>
        <div class="err" id="e-err"></div>
        ${c ? '<div class="row" id="del-row"><button class="btn danger needs-net" id="e-del">刪除這位個案</button></div>' : ''}`,
      foot: '<button class="btn ghost" id="e-cancel">取消</button><button class="btn primary needs-net" id="e-save">儲存</button>',
      onClose: back || render,
    });
    $('#e-cancel').onclick = closeSheet;
    $('#e-save').onclick = async () => {
      const name = $('#e-name').value.replace(/\s+/g, '');
      if (!name) return ($('#e-err').textContent = '請輸入姓名');
      const other = S.caseByName.get(name);
      if (other && other !== c) return ($('#e-err').textContent = `名冊裡已經有「${name}」`);
      const rec = Object.assign({}, c || { id: U.uid('c') }, {
        name, birthday: $('#e-bd').value || null, preterm: $('#e-pt').value.trim(), phone: $('#e-ph').value.trim(),
        phone2: $('#e-ph2').value.trim(), note: $('#e-note').value.trim(),
      });
      const ok = await guard(async () => {
        await S.save('cases', rec);
        // 名字改了或剛新增：把排程上同名的時段連起來
        const oldName = c ? c.name : null;
        const fix = S.data.slots.filter(s => s.kind === 'case' && (s.caseId === rec.id || s.name === name || (oldName && s.name === oldName && !s.caseId)))
          .map(s => Object.assign({}, s, { caseId: rec.id, name }));
        if (fix.length) await S.save('slots', fix);
      }, '已儲存');
      if (ok) closeSheet();
    };
    if (c) $('#e-del').onclick = () => {
      const n = S.data.slots.filter(s => S.caseOf(s) === c).length;
      $('#del-row').innerHTML = `<span class="small">確定刪除「${esc(c.name)}」的聯絡資料？${n ? `排程上的 ${n} 個時段會保留名字。` : ''}</span><button class="btn danger" id="e-del-yes">刪除</button>`;
      $('#e-del-yes').onclick = async () => {
        const ok = await guard(async () => {
          const sl = S.data.slots.filter(s => s.caseId === c.id).map(s => Object.assign({}, s, { caseId: null, name: c.name }));
          if (sl.length) await S.save('slots', sl);
          await S.remove('cases', c.id);
        }, '已刪除');
        if (ok) closeSheet();
      };
    };
  }

  /* ---------- 常用備忘 ---------- */
  function openMemo() {
    openSheet({
      title: '常用備忘', sub: '分機、聯絡人等常用資訊',
      body: `<textarea class="input" id="memo" rows="8">${esc(S.setting('memo', ''))}</textarea>`,
      foot: '<button class="btn primary needs-net" id="memo-save">儲存</button>', onClose: render,
    });
    $('#memo-save').onclick = async () => { const ok = await guard(() => S.setSetting('memo', $('#memo').value), '已儲存'); if (ok) closeSheet(); };
  }

  /* ---------- 匯出 ---------- */
  function openExport() {
    const dates = weekDates();
    openSheet({
      title: '匯出這週排程', sub: `${md(dates[0])} – ${md(dates[4])}　A4 橫向一頁`,
      body: `<div class="options">
        <button class="opt" id="ex-word"><span class="ic" style="font-weight:700;color:var(--blue);width:28px">W</span><span><b>Word 檔</b><div class="small muted">可以再用 Word 修改</div></span></button>
        <button class="opt" id="ex-pdf"><span class="ic" style="font-weight:700;color:var(--red);width:28px">PDF</span><span><b>PDF 檔</b><div class="small muted">適合列印或傳給別人</div></span></button>
      </div><div class="hint" style="margin-top:12px">匯出內容包含實習生顏色、請假與評估標註。</div>`,
      onClose: render,
    });
    const run = async (fn, label) => {
      toast('正在產生' + label + '…', 6000);
      try { await fn(dates); toast(label + '已下載'); closeSheet(); }
      catch (e) { console.error(e); toast('產生' + label + '失敗：' + e.message, 4000); }
    };
    $('#ex-word').onclick = () => run(window.Exporter.word, 'Word 檔');
    $('#ex-pdf').onclick = () => run(window.Exporter.pdf, 'PDF 檔');
  }

  /* ---------- 匯入 ---------- */
  async function readExcel(file) {
    await loadScript('vendor/xlsx.full.min.js');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    return { wb, rows: XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null }) };
  }

  function openImport(mode) {
    if (!S.canEdit()) return toast('目前離線，無法匯入');
    const needC = mode === 'both' || mode === 'contacts';
    const needS = mode === 'both' || mode === 'schedule';
    let contacts = null, sched = null;
    openSheet({
      title: mode === 'contacts' ? '匯入個案聯絡資訊' : mode === 'schedule' ? '匯入排程表' : '從檔案匯入', wide: true,
      body: `
        ${needC ? `<label class="file-drop" id="fd-c"><b>${mode === 'both' ? '第 1 步：' : ''}個案聯絡資訊（Excel）</b><span class="small muted">需要「姓名」欄；會讀取生日、早產、聯絡方式、聯絡方式2。病歷號不會匯入。</span><input type="file" id="f-c" accept=".xlsx,.xls,.csv" class="hidden"></label><div id="rp-c" style="margin:10px 0 16px"></div>` : ''}
        ${needS ? `<label class="file-drop" id="fd-s"><b>${mode === 'both' ? '第 2 步：' : ''}每週排程表（Excel）</b><span class="small muted">第一列為「時間、星期一～星期五」，同一格用「、」分開多位個案。</span><input type="file" id="f-s" accept=".xlsx,.xls,.csv" class="hidden"></label><div id="rp-s" style="margin-top:10px"></div>` : ''}`,
      foot: '<button class="btn ghost" id="im-cancel">取消</button><button class="btn primary" id="im-go" disabled>確認匯入</button>',
      onClose: () => afterLoad(),
    });
    $('#im-cancel').onclick = closeSheet;
    const ready = () => { $('#im-go').disabled = !((!needC || contacts) && (!needS || sched) || (mode === 'both' && (contacts || sched))); };
    const knownNames = () => {
      const set = new Set(S.data.cases.map(c => c.name));
      if (contacts) contacts.cases.forEach(c => set.add(c.name));
      return [...set];
    };
    const parseSched = rows => {
      sched = Importer.parseSchedule(rows, knownNames(), U.parse(realToday()));
      const n = sched.slots.filter(s => s.kind === 'case').length;
      const notes = sched.slots.filter(s => s.kind === 'note');
      const unknown = sched.warnings.filter(w => w.includes('找不到'));
      const other = sched.warnings.filter(w => !w.includes('找不到'));
      const names = knownNames();
      $('#rp-s').innerHTML = `<div class="report"><b>讀到 ${n} 個個案時段${notes.length ? `、${notes.length} 個私人註記` : ''}${sched.marks.length ? `、${sched.marks.length} 筆請假` : ''}</b>
        ${other.length ? `<div style="margin-top:8px;color:var(--red)">請確認：</div><ul>${other.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        ${unknown.length ? `<div style="margin-top:8px">聯絡資訊裡找不到的名字（仍會匯入，之後可在個案資訊中對應）：</div><ul>${unknown.map(w => { const nm = w.match(/「(.+)」/)[1]; const sg = Importer.suggest(nm, names); return `<li>${esc(nm)}${sg.length ? `　<span class="muted">可能是 ${sg.map(esc).join('、')}？</span>` : ''}</li>`; }).join('')}</ul>` : ''}
        ${S.data.slots.length ? `<div style="margin-top:8px;color:var(--red)">注意：確認後會取代目前的排程與請假標註（${S.data.slots.length} 個時段）。</div>` : ''}</div>`;
      $('#fd-s').classList.add('done');
    };
    let schedRows = null;
    if (needC) $('#f-c').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        contacts = Importer.parseContacts((await readExcel(f)).rows);
        const r = contacts.report;
        $('#rp-c').innerHTML = `<div class="report"><b>共 ${r.total} 筆，整理後 ${contacts.cases.length} 位個案</b><ul>
          <li>缺生日：${r.noBirthday} 筆</li><li>缺電話：${r.noPhone} 筆</li>
          ${r.duplicates.length ? `<li>同名已合併：${r.duplicates.map(esc).join('、')}${r.merged.some(m => m.phones.length > 1) ? '（不同的電話都保留，放在電話 2）' : ''}</li>` : ''}
        </ul>${S.data.cases.length ? '<div class="small muted" style="margin-top:6px">已在名冊的個案會更新資料，不會重複新增。</div>' : ''}</div>`;
        $('#fd-c').classList.add('done');
        if (schedRows) parseSched(schedRows);
      } catch (err) { contacts = null; $('#rp-c').innerHTML = `<div class="err">${esc(err.message)}</div>`; }
      ready();
    };
    if (needS) $('#f-s').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { schedRows = (await readExcel(f)).rows; parseSched(schedRows); }
      catch (err) { sched = null; $('#rp-s').innerHTML = `<div class="err">${esc(err.message)}</div>`; }
      ready();
    };
    $('#im-go').onclick = async () => {
      $('#im-go').disabled = true; $('#im-go').textContent = '匯入中…';
      const ok = await guard(async () => {
        if (contacts) {
          const merged = S.data.cases.map(c => Object.assign({}, c));
          const byName = new Map(merged.map(c => [c.name, c]));
          for (const r of contacts.cases) {
            const ex = byName.get(r.name);
            if (ex) ['birthday', 'preterm', 'phone', 'phone2'].forEach(k => { if (r[k]) ex[k] = r[k]; });
            else { const n = Object.assign({ id: U.uid('c'), note: '' }, r); merged.push(n); byName.set(r.name, n); }
          }
          await S.replace('cases', merged);
        }
        if (sched) {
          const byName = new Map(S.data.cases.map(c => [c.name, c]));
          const base = Date.now().toString(36);
          const idMap = {};
          const slots = sched.slots.map((s, i) => {
            const id = 's' + base + '_' + i; idMap[s.id] = id;
            const o = Object.assign({}, s, { id, order: i });
            delete o.source;
            if (o.kind === 'case') o.caseId = byName.has(o.name) ? byName.get(o.name).id : null;
            return o;
          });
          const marks = sched.marks.map(m => ({ id: idMap[m.slot] + '|' + m.date, slot: idMap[m.slot], date: m.date, status: m.status }));
          await S.replace('slots', slots);
          await S.replace('marks', marks);
          if (sched.memo) {
            const cur = S.setting('memo', '');
            if (!cur.includes(sched.memo)) await S.setSetting('memo', cur ? cur + '\n' + sched.memo : sched.memo);
          }
        }
        await S.setSetting('started', true);
      }, '匯入完成');
      if (ok) { U.LS.set('cs_started', true); closeSheet(); }
      else { $('#im-go').disabled = false; $('#im-go').textContent = '確認匯入'; }
    };
  }

  function openRestore() {
    if (!S.canEdit()) return toast('目前離線，無法還原');
    openSheet({
      title: '從備份還原', sub: '使用「備份全部資料」下載的 Excel 檔',
      body: `<label class="file-drop"><b>選擇備份檔</b><span class="small muted">還原後，目前所有資料會被備份檔的內容取代。</span><input type="file" id="f-r" accept=".xlsx" class="hidden"></label><div id="rp-r" style="margin-top:10px"></div>`,
      foot: '<button class="btn ghost" id="r-cancel">取消</button><button class="btn danger" id="r-go" disabled>取代並還原</button>', onClose: render,
    });
    let data = null;
    $('#r-cancel').onclick = closeSheet;
    $('#f-r').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const { wb } = await readExcel(f);
        data = window.Exporter.readBackup(wb);
        $('#rp-r').innerHTML = `<div class="report">備份內容：${data.cases.length} 位個案、${data.slots.length} 個時段、${data.marks.length} 筆標註、${data.interns.length} 位實習生</div>`;
        $('#r-go').disabled = false;
      } catch (err) { $('#rp-r').innerHTML = `<div class="err">${esc(err.message)}</div>`; }
    };
    $('#r-go').onclick = async () => {
      const ok = await guard(async () => { for (const c of ['cases', 'slots', 'marks', 'interns', 'settings']) await S.replace(c, data[c] || []); }, '已從備份還原');
      if (ok) closeSheet();
    };
  }

  function openPassword() {
    openSheet({
      title: '變更密碼', sub: '其他裝置下次開啟時要輸入新密碼',
      body: `<div class="field"><input class="input" type="password" id="np1" placeholder="新密碼（至少 6 個字）" autocomplete="new-password"></div><div class="field"><input class="input" type="password" id="np2" placeholder="再輸入一次" autocomplete="new-password"></div><div class="err" id="np-err"></div>`,
      foot: '<button class="btn primary" id="np-go">變更</button>', onClose: render,
    });
    $('#np-go').onclick = async () => {
      const a = $('#np1').value, b = $('#np2').value;
      if (a.length < 6) return ($('#np-err').textContent = '密碼至少要 6 個字');
      if (a !== b) return ($('#np-err').textContent = '兩次輸入的密碼不一樣');
      try { await S.changePass(a); toast('密碼已變更'); closeSheet(); } catch (e) { $('#np-err').textContent = '變更失敗，請檢查網路'; }
    };
  }

  /* ---------- 連線狀態與自動更新 ---------- */
  window.addEventListener('online', () => { S.online = true; render(); if (S.remote) S.refresh().catch(() => {}); });
  window.addEventListener('offline', () => { S.online = false; render(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.remote && S.key() && S.online) {
      if (!S.lastSync || Date.now() - new Date(S.lastSync) > 20000) S.refresh().catch(() => {});
      if (ui.view === 'day' && U.mondayOf(ui.date) === U.mondayOf(firstWorkday(realToday()))) { /* 跨日時保持今天 */ }
    }
  });
  setInterval(() => { if (document.visibilityState === 'visible' && S.remote && S.key() && S.online && !$('#sheet-root').innerHTML) S.refresh().catch(() => {}); }, 120000);
  S.on(() => { if ($('#topbar') && !$('#sheet-root').innerHTML) render(); });

  window.App = { render, boot, ui };
  boot();
})();
