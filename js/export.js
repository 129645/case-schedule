/* 匯出：一頁式 Word／PDF 週排程、Excel 備份與還原 */
(function () {
  'use strict';
  const S = window.Store, U = window.Util;
  const DAY = ['', '星期一', '星期二', '星期三', '星期四', '星期五'];
  const HEX = { sky: 'CDE4FA', sage: 'D4EBCF', butter: 'FBE5AC', lilac: 'E3D8F5', rose: 'F8D2D6', mint: 'CBECE3', peach: 'FBD9BE', slate: 'D9DFEA' };
  const md = d => { const x = U.parse(d); return `${x.getMonth() + 1}/${x.getDate()}`; };
  const load = src => window.loadScript(src);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function save(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }

  // 每個名字後面的標註文字
  function marksOf(s, e) {
    const m = [];
    if (e.status === 'parent') m.push('假');
    if (e.status === 'sms') m.push('訊');
    if (e.status === 'self') m.push('個假');
    if (e.status === 'helper' && e.helper) m.push(e.helper[0]);
    if (e.eval) m.push('評');
    if (s.only && s.only.length) m.push('臨');
    if (s.note) m.push(s.note);
    return m;
  }

  function weekModel(dates) {
    return U.SLOT_TIMES.map(t => ({
      time: t,
      cells: dates.map(d => S.slotsAt(d, t).map(s => {
        if (s.kind === 'note') return { note: true, text: s.text };
        const e = S.effective(s, d);
        const i = e.intern ? S.internById.get(e.intern) : null;
        return { name: S.nameOf(s), marks: marksOf(s, e), color: i ? i.color : null, off: e.status === 'parent' || e.status === 'self' || e.status === 'sms' };
      })),
    }));
  }
  const titleOf = dates => {
    const y = U.parse(dates[0]).getFullYear();
    return `個案排程表　${y}/${md(dates[0])}（一）– ${md(dates[4])}（五）`;
  };
  const fileOf = (dates, ext) => `個案排程表_${dates[0].replace(/-/g, '')}-${dates[4].slice(5).replace('-', '')}.${ext}`;
  const usedInterns = model => {
    const used = new Set();
    model.forEach(r => r.cells.forEach(c => c.forEach(x => { if (x.color) used.add(x.color); })));
    return S.data.interns.filter(i => used.has(i.color));
  };
  const LEGEND = '標註：訊＝已傳送簡訊請假　假＝已向家長請假　個假＝個案自己請假　林／吳／蕭＝由該治療師協助　評＝需評估　臨＝只有特定日期　刪除線＝當天不上課';

  /* ---------- Word ---------- */
  async function word(dates) {
    await load('vendor/docx.umd.js');
    const D = window.docx;
    const model = weekModel(dates);
    const today = U.fmt(new Date());
    const FONT = { ascii: 'Microsoft JhengHei', eastAsia: 'Microsoft JhengHei', hAnsi: 'Microsoft JhengHei' };
    const run = (text, o = {}) => new D.TextRun(Object.assign({ text, font: FONT, size: 15 }, o));
    const border = { style: D.BorderStyle.SINGLE, size: 4, color: 'C9CED8' };
    const borders = { top: border, bottom: border, left: border, right: border };
    const margins = { top: 30, bottom: 30, left: 60, right: 60 };
    const TOTAL = 16838 - 2 * 567; // A4 橫向扣掉左右邊界
    const TW = 820, DW = Math.floor((TOTAL - TW) / 5);

    const headCell = (text, w, fill) => new D.TableCell({
      width: { size: w, type: D.WidthType.DXA }, borders, margins, shading: { fill: fill || 'EEF1F6', type: D.ShadingType.CLEAR, color: 'auto' },
      verticalAlign: D.VerticalAlign.CENTER,
      children: [new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [run(text, { bold: true, size: 17 })] })],
    });
    const rows = [new D.TableRow({ tableHeader: true, children: [headCell('時間', TW), ...dates.map((d, i) => headCell(`${DAY[i + 1]}　${md(d)}`, DW))] })];
    model.forEach(r => {
      if (r.time === '13:30') rows.push(new D.TableRow({ children: [new D.TableCell({ columnSpan: 6, borders, margins: { top: 10, bottom: 10, left: 60, right: 60 }, shading: { fill: 'F4F5F8', type: D.ShadingType.CLEAR, color: 'auto' }, children: [new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [run('午休 12:00 – 13:30', { size: 13, color: '8A92A5' })] })] })] }));
      rows.push(new D.TableRow({
        cantSplit: true,
        children: [
          new D.TableCell({ width: { size: TW, type: D.WidthType.DXA }, borders, margins, children: [new D.Paragraph({ children: [run(r.time, { size: 15, color: '5B6478' })] })] }),
          ...r.cells.map(items => {
            const kids = [];
            items.forEach((x, i) => {
              if (i) kids.push(run('  '));
              if (x.note) { kids.push(run(x.text, { italics: true, color: '8A92A5', size: 13 })); return; }
              const o = { strike: x.off, color: x.off ? '8A92A5' : '1E2B45' };
              if (x.color) o.shading = { type: D.ShadingType.CLEAR, fill: HEX[x.color], color: 'auto' };
              kids.push(run(x.name, o));
              if (x.marks.length) kids.push(run('(' + x.marks.join('·') + ')', Object.assign({}, o, { size: 12, strike: false })));
            });
            return new D.TableCell({ width: { size: DW, type: D.WidthType.DXA }, borders, margins, children: [new D.Paragraph({ children: kids })] });
          }),
        ],
      }));
    });
    const interns = usedInterns(model);
    const legendRuns = [run(LEGEND, { size: 13, color: '5B6478' })];
    if (interns.length) {
      legendRuns.push(run('　實習生：', { size: 13, color: '5B6478' }));
      interns.forEach(i => { legendRuns.push(run(' ' + i.name + ' ', { size: 13, shading: { type: D.ShadingType.CLEAR, fill: HEX[i.color], color: 'auto' } })); legendRuns.push(run(' ', { size: 13 })); });
    }
    const doc = new D.Document({
      creator: '個案排程表', title: titleOf(dates),
      styles: { default: { document: { run: { font: 'Microsoft JhengHei' } } } },
      sections: [{
        properties: { page: { size: { orientation: D.PageOrientation.LANDSCAPE, width: 11906, height: 16838 }, margin: { top: 500, bottom: 400, left: 567, right: 567 } } },
        children: [
          new D.Paragraph({ spacing: { after: 80 }, tabStops: [{ type: D.TabStopType.RIGHT, position: TOTAL }], children: [run(titleOf(dates), { bold: true, size: 26 }), run('\t匯出日期 ' + today.replace(/-/g, '/'), { size: 14, color: '8A92A5' })] }),
          new D.Table({ width: { size: TOTAL, type: D.WidthType.DXA }, columnWidths: [TW, DW, DW, DW, DW, DW], layout: D.TableLayoutType.FIXED, rows }),
          new D.Paragraph({ spacing: { before: 60 }, children: legendRuns }),
        ],
      }],
    });
    const blob = await D.Packer.toBlob(doc);
    save(blob, fileOf(dates, 'docx'));
    return blob;
  }

  /* ---------- PDF ---------- */
  function exportHTML(dates) {
    const model = weekModel(dates);
    const css = {
      bg: { sky: '#CDE4FA', sage: '#D4EBCF', butter: '#FBE5AC', lilac: '#E3D8F5', rose: '#F8D2D6', mint: '#CBECE3', peach: '#FBD9BE', slate: '#D9DFEA' },
    };
    const cell = items => items.map(x => x.note
      ? `<span style="color:#8A92A5;font-size:11px">${esc(x.text)}</span>`
      : `<span style="display:inline-block;margin:1px 4px 1px 0;padding:1px 4px;border-radius:3px;${x.color ? 'background:' + css.bg[x.color] + ';' : ''}${x.off ? 'text-decoration:line-through;color:#8A92A5;' : ''}">${esc(x.name)}${x.marks.length ? `<span style="font-size:10px;color:#5B6478">(${esc(x.marks.join('·'))})</span>` : ''}</span>`).join('');
    const interns = usedInterns(model);
    let rows = '';
    model.forEach(r => {
      if (r.time === '13:30') rows += '<tr><td colspan="6" style="background:#F4F5F8;color:#8A92A5;text-align:center;font-size:11px;padding:2px">午休 12:00 – 13:30</td></tr>';
      rows += `<tr><td style="color:#5B6478;white-space:nowrap">${r.time}</td>${r.cells.map(c => `<td>${cell(c)}</td>`).join('')}</tr>`;
    });
    return `<div style="width:1123px;padding:26px 30px;background:#fff;color:#1E2B45;font-family:'PingFang TC','Noto Sans TC','Microsoft JhengHei',sans-serif;font-size:12.5px;line-height:1.35">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px"><b style="font-size:19px">${esc(titleOf(dates))}</b><span style="color:#8A92A5;font-size:11px">匯出日期 ${U.fmt(new Date()).replace(/-/g, '/')}</span></div>
      <table style="width:100%;border-collapse:collapse;table-layout:fixed">
        <colgroup><col style="width:56px">${dates.map(() => '<col>').join('')}</colgroup>
        <thead><tr><th style="background:#EEF1F6">時間</th>${dates.map((d, i) => `<th style="background:#EEF1F6">${DAY[i + 1]}　${md(d)}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:8px;font-size:11px;color:#5B6478">${esc(LEGEND)}${interns.length ? '　實習生：' + interns.map(i => `<span style="background:${css.bg[i.color]};padding:1px 5px;border-radius:3px;margin-right:4px;color:#1E2B45">${esc(i.name)}</span>`).join('') : ''}</div>
      <style>#export-stage td,#export-stage th{border:1px solid #C9CED8;padding:3px 5px;vertical-align:top;text-align:left}#export-stage th{text-align:center;font-weight:600}</style>
    </div>`;
  }

  async function pdf(dates) {
    await Promise.all([load('vendor/html2canvas.min.js'), load('vendor/jspdf.umd.min.js')]);
    const stage = document.getElementById('export-stage');
    stage.innerHTML = exportHTML(dates);
    try {
      const node = stage.firstElementChild;
      const canvas = await window.html2canvas(node, { scale: 2, backgroundColor: '#ffffff', logging: false });
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const W = 297, H = 210, m = 6;
      let w = W - 2 * m, h = canvas.height * w / canvas.width;
      if (h > H - 2 * m) { h = H - 2 * m; w = canvas.width * h / canvas.height; }
      doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', (W - w) / 2, m, w, h);
      const blob = doc.output('blob');
      save(blob, fileOf(dates, 'pdf'));
      return blob;
    } finally { stage.innerHTML = ''; }
  }

  /* ---------- 備份 ---------- */
  async function backup() {
    await load('vendor/xlsx.full.min.js');
    const X = window.XLSX;
    const wb = X.utils.book_new();
    const today = U.fmt(new Date());
    const intern = id => (S.internById.get(id) || {}).name || '';
    const STATUS = { sms: '已傳送簡訊請假', parent: '已向家長請假', self: '個案自己請假', helper: '請其他治療師協助', none: '正常上課' };
    const cases = S.data.cases.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')).map(c => ({
      姓名: c.name, 生日: c.birthday || '', 目前年齡: U.ageText(U.ageBetween(c.birthday, today)), 早產: c.preterm || '', 聯絡方式: c.phone || '', 聯絡方式2: c.phone2 || '', 備註: c.note || '',
    }));
    const slots = S.data.slots.slice().sort((a, b) => a.day - b.day || a.time.localeCompare(b.time) || (a.order || 0) - (b.order || 0)).map(s => ({
      星期: DAY[s.day], 時間: s.time, 類型: s.kind === 'note' ? '私人註記' : '個案', '姓名／內容': s.kind === 'note' ? s.text : S.nameOf(s), 備註: s.note || '',
      每週協助治療師: s.helper || '', 每週實習生: intern(s.intern), 只有這些日期: (s.only || []).join('、'), 開始日: s.start || '', 結束日: s.end || '',
    }));
    const marks = S.data.marks.slice().sort((a, b) => a.date.localeCompare(b.date)).map(m => {
      const s = S.data.slots.find(x => x.id === m.slot) || {};
      return { 日期: m.date, 星期: DAY[s.day] || '', 時間: s.time || '', 姓名: s.kind ? S.nameOf(s) : '', 狀態: STATUS[m.status] || '', 協助治療師: m.helper || '', 這次的實習生: m.intern != null ? (intern(m.intern) || '自己') : '', 需評估: m.eval ? '是' : '' };
    });
    const add = (rows, name, widths) => { const ws = X.utils.json_to_sheet(rows.length ? rows : [{}]); ws['!cols'] = widths.map(w => ({ wch: w })); X.utils.book_append_sheet(wb, ws, name); };
    add(cases, '個案', [10, 12, 14, 8, 18, 18, 20]);
    add(slots, '每週排程', [8, 7, 9, 18, 10, 12, 10, 24, 12, 12]);
    add(marks, '單日標註', [12, 8, 7, 10, 14, 10, 12, 8]);
    add(S.data.interns.map(i => ({ 姓名: i.name, 顏色: (U.PALETTE.find(p => p.key === i.color) || {}).name || i.color })), '實習生', [12, 12]);
    // 還原用的完整資料
    const json = JSON.stringify({ v: 1, at: new Date().toISOString(), data: S.data });
    const chunks = []; for (let i = 0; i < json.length; i += 30000) chunks.push([json.slice(i, i + 30000)]);
    const ws = X.utils.aoa_to_sheet([['請勿修改此工作表：還原備份時使用'], ...chunks]);
    X.utils.book_append_sheet(wb, ws, '_還原資料');
    X.writeFile(wb, `個案排程表_備份_${today.replace(/-/g, '')}.xlsx`);
  }

  function readBackup(wb) {
    const ws = wb.Sheets['_還原資料'];
    if (!ws) throw new Error('這不是個案排程表的備份檔（找不到「_還原資料」工作表）');
    const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
    const json = rows.slice(1).map(r => r[0] || '').join('');
    const o = JSON.parse(json);
    if (!o || !o.data) throw new Error('備份檔內容無法讀取');
    return o.data;
  }

  window.Exporter = { word, pdf, backup, readBackup, exportHTML };
})();
