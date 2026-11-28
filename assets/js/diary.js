/* SpyOptionaire trade diary.
   Storage: the trader's own browser (localStorage) until cloud accounts are switched on; then Supabase with row-level security, so each
   trader reads and writes only their own rows (the site admin can read all rows, which the page says).
   Everything the trader types is shown with textContent, never as HTML. */
(function () {
  'use strict';
  var CFG = window.DIARY_CFG || {};
  var LS_KEY = 'spyo_diary_v1';
  var PV = { ES: 50, MES: 5, NQ: 20, MNQ: 2, RTY: 50, M2K: 5, YM: 5, MYM: 0.5, CL: 1000, MCL: 100, GC: 100, MGC: 10, SI: 5000, SIL: 1000, '6E': 125000, M6E: 12500, ZB: 1000, ZN: 1000 };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'cls') e.className = attrs[k]; else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function money(x, dec) { if (x == null || isNaN(x)) return '-'; var s = Math.abs(x).toLocaleString(undefined, { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }); return (x < 0 ? '-$' : '$') + s; }
  function pct(x) { return x == null || isNaN(x) ? '-' : Math.round(x * 100) + '%'; }
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1')); return isNaN(n) ? null : n; }
  function uid() { return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function net(t) { return (t.pnl || 0) - (t.fees || 0); }
  function root(sym) { var s = String(sym || '').toUpperCase().trim().split(/[\s.]/)[0]; s = s.replace(/[FGHJKMNQUVXZ]\d{1,2}$/, ''); return s; }
  function autoPnl(t) {
    if (t.entry == null || t.exit == null || !t.qty) return null;
    var dir = t.side === 'short' ? -1 : 1, mult = PV[root(t.symbol)];
    if (t.kind === 'option') mult = 100; else if (t.kind === 'stock') mult = 1;
    if (!mult) return null;
    return Math.round((t.exit - t.entry) * dir * t.qty * mult * 100) / 100;
  }

  /* ---------------- storage ---------------- */
  var Store = {
    mode: 'local', sb: null, user: null, admin: false,
    init: function () {
      var self = this;
      if (!(CFG.supabase_url && CFG.anon_key && window.supabase && window.supabase.createClient)) return Promise.resolve();
      self.sb = window.supabase.createClient(CFG.supabase_url, CFG.anon_key);
      return self.sb.auth.getSession().then(function (r) {
        var s = r && r.data && r.data.session;
        if (s) { self.user = s.user; self.mode = 'cloud'; return self.sb.from('diary_admins').select('user_id').eq('user_id', s.user.id).then(function (a) { self.admin = !!(a.data && a.data.length); }); }
      });
    },
    signIn: function (email) { return this.sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.href.split('#')[0] } }); },
    signOut: function () { return this.sb.auth.signOut().then(function () { location.reload(); }); },
    local: function () { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; } },
    saveLocal: function (a) { try { localStorage.setItem(LS_KEY, JSON.stringify(a)); } catch (e) { alertBox('Could not save on this device: ' + e.message); } },
    toRow: function (t) { return { trade_date: t.date, time_in: t.tin || null, time_out: t.tout || null, symbol: t.symbol, kind: t.kind || 'futures', side: t.side, qty: t.qty, entry: t.entry, exit_price: t.exit, pnl: t.pnl, fees: t.fees || 0, account: t.account || null, setup: t.setup || null, grade: t.grade || null, notes: t.notes || null }; },
    fromRow: function (r) { return { id: r.id, date: r.trade_date, tin: r.time_in || '', tout: r.time_out || '', symbol: r.symbol, kind: r.kind || 'futures', side: r.side, qty: r.qty, entry: r.entry, exit: r.exit_price, pnl: +r.pnl, fees: +(r.fees || 0), account: r.account || '', setup: r.setup || '', grade: r.grade || '', notes: r.notes || '', user_id: r.user_id, user_email: r.user_email }; },
    list: function (all) {
      var self = this;
      if (self.mode !== 'cloud') return Promise.resolve(self.local());
      var out = [], from = 0, step = 1000;
      function page() {
        var q = self.sb.from('diary_trades').select('*').order('trade_date').order('time_in').range(from, from + step - 1);
        if (!all) q = q.eq('user_id', self.user.id);
        return q.then(function (r) { if (r.error) throw r.error; out = out.concat(r.data.map(self.fromRow)); if (r.data.length === step) { from += step; return page(); } return out; });
      }
      return page();
    },
    add: function (arr) {
      var self = this;
      if (self.mode !== 'cloud') { var a = self.local(); arr.forEach(function (t) { t.id = uid(); a.push(t); }); self.saveLocal(a); return Promise.resolve(); }
      var rows = arr.map(self.toRow), chunks = [];
      for (var i = 0; i < rows.length; i += 500) chunks.push(rows.slice(i, i + 500));
      return chunks.reduce(function (p, c) { return p.then(function () { return self.sb.from('diary_trades').insert(c).then(function (r) { if (r.error) throw r.error; }); }); }, Promise.resolve());
    },
    update: function (t) {
      var self = this;
      if (self.mode !== 'cloud') { var a = self.local().map(function (x) { return x.id === t.id ? t : x; }); self.saveLocal(a); return Promise.resolve(); }
      return self.sb.from('diary_trades').update(self.toRow(t)).eq('id', t.id).then(function (r) { if (r.error) throw r.error; });
    },
    remove: function (ids) {
      var self = this;
      if (self.mode !== 'cloud') { var a = self.local().filter(function (x) { return ids.indexOf(x.id) < 0; }); self.saveLocal(a); return Promise.resolve(); }
      return self.sb.from('diary_trades').delete().in('id', ids).then(function (r) { if (r.error) throw r.error; });
    }
  };

  /* ---------------- stats ---------------- */
  function byDay(trades) {
    var m = {}, out = [];
    trades.forEach(function (t) { (m[t.date] = m[t.date] || []).push(t); });
    Object.keys(m).sort().forEach(function (d) {
      var ts = m[d].slice().sort(function (a, b) { return String(a.tout || a.tin).localeCompare(String(b.tout || b.tin)); });
      out.push({ date: d, list: ts, trades: ts.map(net), pnl: ts.reduce(function (a, t) { return a + net(t); }, 0) });
    });
    return out;
  }
  function stats(trades) {
    var n = trades.length, w = trades.filter(function (t) { return net(t) > 0; }), l = trades.filter(function (t) { return net(t) < 0; });
    var gw = w.reduce(function (a, t) { return a + net(t); }, 0), gl = -l.reduce(function (a, t) { return a + net(t); }, 0);
    var aw = w.length ? gw / w.length : 0, al = l.length ? gl / l.length : 0, days = byDay(trades);
    var eq = 0, peak = 0, drop = 0, streak = 0, worstStreak = 0;
    days.forEach(function (d) { d.list.forEach(function (t) { eq += net(t); peak = Math.max(peak, eq); drop = Math.max(drop, peak - eq); if (net(t) < 0) { streak++; worstStreak = Math.max(worstStreak, streak); } else if (net(t) > 0) streak = 0; }); });
    var be = (aw + al) ? al / (aw + al) : null, wr = (w.length + l.length) ? w.length / (w.length + l.length) : null;
    var dp = days.map(function (d) { return d.pnl; }), total = gw - gl;
    var best = dp.length ? Math.max.apply(null, dp) : 0;
    return { n: n, net: total, wins: w.length, losses: l.length, wr: wr, aw: aw, al: al, be: be, over: (wr != null && be != null) ? wr - be : null,
             pf: gl ? gw / gl : null, drop: drop, days: days.length, green: days.length ? dp.filter(function (x) { return x > 0; }).length / days.length : null,
             best: best, worst: dp.length ? Math.min.apply(null, dp) : 0, perDay: days.length ? n / days.length : 0, worstStreak: worstStreak,
             bestShare: total > 0 ? best / total : null, dayList: days };
  }
  function group(trades, keyFn) {
    var m = {};
    trades.forEach(function (t) { var k = keyFn(t); if (k == null || k === '') return; (m[k] = m[k] || []).push(t); });
    return Object.keys(m).map(function (k) { var s = stats(m[k]); return { key: k, n: s.n, net: s.net, wr: s.wr, avg: s.n ? s.net / s.n : 0 }; })
      .sort(function (a, b) { return b.net - a.net; });
  }
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function insights(trades) {
    var out = [], s = stats(trades);
    if (s.n < 10) return ['Log at least 10 trades and the patterns start showing here.'];
    if (s.be != null) out.push('Your average loser is ' + money(s.al) + ' and your average winner ' + money(s.aw) + ', so you need to win ' + pct(s.be) + ' to break even. You win ' + pct(s.wr) + (s.over >= 0 ? ', ' + Math.round(s.over * 100) + ' points over.' : ', ' + Math.round(-s.over * 100) + ' points under. Fix the size of the losers first.'));
    // after two losers in a day
    var after = [], first = [], later = [];
    s.dayList.forEach(function (d) { var lossRun = 0; d.list.forEach(function (t, i) { var v = net(t); (i === 0 ? first : later).push(v); if (lossRun >= 2) after.push(v); lossRun = v < 0 ? lossRun + 1 : 0; }); });
    if (after.length >= 5) { var a = after.reduce(function (x, y) { return x + y; }, 0); out.push('Trades taken after 2 losers in a row on the same day: ' + after.length + ' trades, ' + money(a) + ' total (' + money(a / after.length) + ' each).' + (a < 0 ? ' A 2-loss day stop would have saved that.' : '')); }
    if (first.length >= 5 && later.length >= 5) {
      var fa = first.reduce(function (x, y) { return x + y; }, 0) / first.length, la = later.reduce(function (x, y) { return x + y; }, 0) / later.length;
      out.push('First trade of the day averages ' + money(fa) + '; every trade after it averages ' + money(la) + '.' + (la < 0 && fa > 0 ? ' Your first idea is your best one.' : ''));
    }
    var hours = group(trades.filter(function (t) { return t.tin; }), function (t) { return t.tin.slice(0, 2) + ':00'; }).filter(function (g) { return g.n >= 5; });
    if (hours.length >= 2) out.push('Best hour: ' + hours[0].key + ' (' + money(hours[0].net) + ' on ' + hours[0].n + ' trades). Worst hour: ' + hours[hours.length - 1].key + ' (' + money(hours[hours.length - 1].net) + ').');
    var setups = group(trades, function (t) { return t.setup; }).filter(function (g) { return g.n >= 5; });
    if (setups.length >= 2) out.push('Best setup: ' + setups[0].key + ' (' + money(setups[0].net) + ', ' + pct(setups[0].wr) + ' winners). Worst: ' + setups[setups.length - 1].key + ' (' + money(setups[setups.length - 1].net) + ').');
    var grades = group(trades, function (t) { return t.grade; });
    var gA = grades.filter(function (g) { return g.key === 'A'; })[0], gC = grades.filter(function (g) { return g.key === 'C'; })[0];
    if (gA && gC && gA.n >= 3 && gC.n >= 3) out.push('A setups average ' + money(gA.avg) + ' a trade; C setups average ' + money(gC.avg) + '.' + (gC.avg < 0 ? ' Skipping C setups would have added ' + money(-gC.net) + '.' : ''));
    var busy = s.dayList.filter(function (d) { return d.list.length > Math.max(3, Math.round(s.perDay * 1.5)); });
    if (busy.length >= 3) { var bp = busy.reduce(function (a, d) { return a + d.pnl; }, 0); out.push('Your ' + busy.length + ' busiest days (more than ' + Math.max(3, Math.round(s.perDay * 1.5)) + ' trades) made ' + money(bp) + ' in total.' + (bp < 0 ? ' Overtrading is costing you.' : '')); }
    if (s.bestShare != null && s.bestShare > 0.4) out.push('Your best day is ' + pct(s.bestShare) + ' of your total profit. Prop firms with a 40% consistency rule would make you keep trading until it drops under 40%.');
    return out;
  }

  /* ---------------- CSV import ---------------- */
  function parseCSV(text) {
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
  }
  function toDate(s) {
    s = String(s || '').trim(); var m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) { var y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2); }
    var d = new Date(s); return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }
  function toTime(s) { var m = String(s || '').match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/); if (!m) return ''; var h = +m[1]; if (m[3]) { var pm = /p/i.test(m[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; } return ('0' + h).slice(-2) + ':' + m[2]; }
  function importRows(rows) {
    var H = rows[0].map(function (h) { return String(h).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); });
    var find = function (names) { for (var i = 0; i < names.length; i++) { var j = H.indexOf(names[i]); if (j >= 0) return j; } return -1; };
    var c = {
      date: find(['date', 'trade date', 'entry time', 'boughttimestamp', 'bought timestamp', 'open time', 'opened', 'time']),
      tin: find(['entry time', 'boughttimestamp', 'bought timestamp', 'open time', 'time in', 'opened']),
      tout: find(['exit time', 'soldtimestamp', 'sold timestamp', 'close time', 'time out', 'closed']),
      sym: find(['instrument', 'symbol', 'contract', 'ticker', 'product']),
      side: find(['market pos', 'side', 'direction', 'action', 'type', 'position']),
      qty: find(['qty', 'quantity', 'contracts', 'size', 'shares']),
      entry: find(['entry price', 'entry', 'avg entry', 'open price', 'buyprice', 'buy price', 'price in']),
      exit: find(['exit price', 'exit', 'avg exit', 'close price', 'sellprice', 'sell price', 'price out']),
      pnl: find(['profit', 'pnl', 'p l', 'net p l', 'realized p l', 'gross p l', 'realized pnl', 'net pnl', 'p&l']),
      fees: find(['commission', 'commissions', 'fees', 'fee']),
      acct: find(['account', 'account name']),
      setup: find(['strategy', 'setup', 'tag', 'entry name']), notes: find(['notes', 'note', 'comment'])
    };
    if (c.sym < 0 || (c.pnl < 0 && (c.entry < 0 || c.exit < 0))) throw new Error('Could not find the symbol and P&L (or entry and exit price) columns.');
    if (c.date < 0) throw new Error('Could not find a date column.');
    var out = [];
    rows.slice(1).forEach(function (r) {
      var g = function (k) { return c[k] >= 0 ? r[c[k]] : ''; };
      var date = toDate(g('date')); if (!date) return;
      var sd = String(g('side')).toLowerCase(), side = /short|sell|^s$/.test(sd) ? 'short' : 'long';
      if (c.side < 0 && c.tin >= 0 && c.tout >= 0 && H[c.tin].indexOf('bought') >= 0) side = new Date(g('tin')) <= new Date(g('tout')) ? 'long' : 'short';
      var t = { date: date, tin: toTime(g('tin')), tout: toTime(g('tout')), symbol: String(g('sym')).trim(), kind: 'futures', side: side, qty: Math.abs(num(g('qty')) || 1),
                entry: num(g('entry')), exit: num(g('exit')), pnl: num(g('pnl')), fees: Math.abs(num(g('fees')) || 0), account: String(g('acct')).trim(),
                setup: String(g('setup')).trim(), grade: '', notes: String(g('notes')).trim() };
      if (/^[A-Z]{1,5}\s*\d{6}[CP]/.test(t.symbol.toUpperCase()) || /\d+(\.\d+)?\s*[CP]$/i.test(t.symbol)) t.kind = 'option';
      if (t.pnl == null) t.pnl = autoPnl(t);
      if (t.pnl == null) return;
      out.push(t);
    });
    return out;
  }

  /* ---------------- charts ---------------- */
  function chart(canvas, days) {
    var dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    var g = canvas.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
    if (!days.length) return;
    var eq = [], c = 0; days.forEach(function (d) { c += d.pnl; eq.push(c); });
    var mx = Math.max.apply(null, days.map(function (d) { return Math.abs(d.pnl); })) || 1;
    var emin = Math.min(0, Math.min.apply(null, eq)), emax = Math.max(0, Math.max.apply(null, eq)) || 1;
    var pad = 6, bw = (W - 2 * pad) / days.length, mid = H * 0.5;
    g.strokeStyle = '#262c35'; g.beginPath(); g.moveTo(0, mid); g.lineTo(W, mid); g.stroke();
    days.forEach(function (d, i) { var h = (d.pnl / mx) * (H * 0.45); g.fillStyle = d.pnl >= 0 ? 'rgba(34,197,94,.55)' : 'rgba(239,68,68,.55)'; g.fillRect(pad + i * bw + bw * 0.15, mid - Math.max(h, 0), Math.max(1, bw * 0.7), Math.abs(h)); });
    g.strokeStyle = '#e6e8eb'; g.lineWidth = 2; g.beginPath();
    eq.forEach(function (v, i) { var x = pad + (i + 0.5) * bw, y = H - 6 - (v - emin) / (emax - emin) * (H - 12); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
  }

  /* ---------------- UI ---------------- */
  var ALL = [], VIEW = [], editing = null;
  function alertBox(msg, ok) { var b = $('#dmsg'); if (!b) return; b.textContent = msg; b.className = 'dmsg ' + (ok ? 'ok' : 'err'); b.hidden = false; setTimeout(function () { b.hidden = true; }, 6000); }
  function load() { return Store.list(false).then(function (a) { ALL = a; filter(); }).catch(function (e) { alertBox('Could not load trades: ' + (e.message || e)); }); }
  function filter() {
    var f = $('#ffrom').value, t = $('#fto').value, ac = $('#facct').value;
    VIEW = ALL.filter(function (x) { return (!f || x.date >= f) && (!t || x.date <= t) && (!ac || x.account === ac); });
    render();
  }
  function fillAccounts() {
    var accts = Array.from(new Set(ALL.map(function (t) { return t.account; }).filter(Boolean))).sort();
    var sel = $('#facct'), cur = sel.value; sel.textContent = ''; sel.appendChild(el('option', { value: '', text: 'All accounts' }));
    accts.forEach(function (a) { sel.appendChild(el('option', { value: a, text: a })); }); sel.value = cur;
    var dl = $('#acctlist'); dl.textContent = ''; accts.forEach(function (a) { dl.appendChild(el('option', { value: a })); });
    var sl = $('#setuplist'); sl.textContent = ''; Array.from(new Set(ALL.map(function (t) { return t.setup; }).filter(Boolean))).sort().forEach(function (a) { sl.appendChild(el('option', { value: a })); });
  }
  function tile(label, value, cls) { return el('div', { cls: 'dt' }, [el('dt', { text: label }), el('dd', { cls: cls || '', text: value })]); }
  function render() {
    fillAccounts();
    var s = stats(VIEW);
    var T = $('#dtiles'); T.textContent = '';
    [['Net P&L', money(s.net), s.net >= 0 ? 'up' : 'dn'], ['Trades', String(s.n)], ['Win rate', pct(s.wr)], ['Breakeven win rate', pct(s.be)],
     ['Over breakeven', s.over == null ? '-' : (s.over >= 0 ? '+' : '') + Math.round(s.over * 100) + ' pts', s.over >= 0 ? 'up' : 'dn'], ['Avg winner', money(s.aw)], ['Avg loser', money(-s.al)],
     ['Profit factor', s.pf == null ? '-' : s.pf.toFixed(2)], ['Biggest drop', money(-s.drop)], ['Green days', pct(s.green)], ['Trades a day', s.perDay.toFixed(1)], ['Most losers in a row', String(s.worstStreak)]]
      .forEach(function (x) { T.appendChild(tile(x[0], x[1], x[2])); });
    chart($('#dchart'), s.dayList);
    var I = $('#dins'); I.textContent = ''; insights(VIEW).forEach(function (x) { I.appendChild(el('li', { text: x })); });
    var B = $('#dbreak'); B.textContent = '';
    [['Setup', function (t) { return t.setup; }], ['Symbol', function (t) { return root(t.symbol) || t.symbol; }], ['Account', function (t) { return t.account; }],
     ['Weekday', function (t) { return WD[new Date(t.date + 'T12:00:00').getDay()]; }], ['Hour', function (t) { return t.tin ? t.tin.slice(0, 2) + ':00' : ''; }], ['Grade', function (t) { return t.grade; }]]
      .forEach(function (x) {
        var g = group(VIEW, x[1]); if (!g.length) return;
        var tb = el('table', { cls: 'dtab' }, [el('thead', null, [el('tr', null, [el('th', { text: x[0] }), el('th', { text: 'Trades' }), el('th', { text: 'Win' }), el('th', { text: 'Net' })])])]);
        var bd = el('tbody'); g.forEach(function (r) { bd.appendChild(el('tr', null, [el('td', { text: r.key }), el('td', { text: String(r.n) }), el('td', { text: pct(r.wr) }), el('td', { cls: r.net >= 0 ? 'up' : 'dn', text: money(r.net) })])); });
        tb.appendChild(bd); B.appendChild(el('div', { cls: 'card' }, [tb]));
      });
    var L = $('#dlist'); L.textContent = '';
    VIEW.slice().reverse().slice(0, 300).forEach(function (t) {
      var v = net(t);
      L.appendChild(el('tr', null, [el('td', { text: t.date + (t.tin ? ' ' + t.tin : '') }), el('td', { text: t.symbol }), el('td', { text: t.side === 'short' ? 'Short' : 'Long' }),
        el('td', { text: t.qty == null ? '' : String(t.qty) }), el('td', { cls: v >= 0 ? 'up' : 'dn', text: money(v, 2) }), el('td', { text: [t.setup, t.grade].filter(Boolean).join(' · ') }),
        el('td', null, [el('button', { cls: 'lnk', text: 'Edit', onclick: function () { edit(t); } })])]));
    });
    $('#dcount').textContent = VIEW.length > 300 ? 'Newest 300 of ' + VIEW.length + ' trades' : VIEW.length + ' trades';
    if (!$('#pane-opt').hidden) runOpt();
  }
  function formTrade() {
    var f = $('#dform'), g = function (n) { return f.elements[n].value; };
    var t = { date: g('date'), tin: g('tin'), tout: g('tout'), symbol: g('symbol').trim().toUpperCase(), kind: g('kind'), side: g('side'), qty: num(g('qty')),
              entry: num(g('entry')), exit: num(g('exit')), pnl: num(g('pnl')), fees: num(g('fees')) || 0, account: g('account').trim(), setup: g('setup').trim(), grade: g('grade'), notes: g('notes').trim() };
    if (t.pnl == null) t.pnl = autoPnl(t);
    return t;
  }
  function edit(t) {
    editing = t; var f = $('#dform');
    ['date', 'tin', 'tout', 'symbol', 'kind', 'side', 'qty', 'entry', 'exit', 'pnl', 'fees', 'account', 'setup', 'grade', 'notes'].forEach(function (k) { f.elements[k].value = t[k] == null ? '' : t[k]; });
    $('#dsave').textContent = 'Save changes'; $('#ddel').hidden = false; tab('log'); f.scrollIntoView({ behavior: 'smooth' });
  }
  function resetForm() { editing = null; var f = $('#dform'); f.reset(); f.elements.date.value = new Date().toISOString().slice(0, 10); $('#dsave').textContent = 'Add trade'; $('#ddel').hidden = true; $('#dpnlhint').textContent = ''; }
  function tab(name) { $$('.dtabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.t === name); }); $$('.dpane').forEach(function (p) { p.hidden = p.id !== 'pane-' + name; }); if (name === 'opt') runOpt(); }

  /* ---------------- optimizer view ---------------- */
  function runOpt() {
    var O = $('#dopt'); O.textContent = '';
    var days = byDay(VIEW).map(function (d) { return { date: d.date, trades: d.trades }; });
    if (days.length < 10) { O.appendChild(el('p', { cls: 'empty', text: 'Log at least 10 trading days to compare accounts. You have ' + days.length + '.' })); return; }
    var prices = {}; $$('.dprice').forEach(function (i) { var v = num(i.value); if (v != null) prices[i.dataset.id] = v; });
    var res = window.DiaryFirms.optimize(days, { prices: prices, personalBalance: num($('#pbal').value) || 2500, personalSize: num($('#psize').value) || 100 });
    var best = res[0];
    O.appendChild(el('div', { cls: 'card dbest' }, [el('div', { cls: 'dk', text: 'Your best account on these ' + days.length + ' trading days' }), el('div', { cls: 'dbn', text: best.name }),
      el('div', { cls: best.net >= 0 ? 'up' : 'dn', text: money(best.net) + ' after fees' + (best.kind === 'personal' ? '' : ', what you would have been paid') })]));
    res.forEach(function (r, i) {
      var rows = [];
      if (r.kind === 'prop') {
        var w = r.walk, ro = r.roll;
        rows = [['Net after fees', money(r.net)], ['Paid to you', money(w.paid)], ['Fees', money(-w.fees) + (r.walk.evals ? ' (' + w.evals + ' eval' + (w.evals === 1 ? '' : 's') + ' at ' + money(r.price, 2) + ')' : '')],
                ['Evals passed / failed', w.passes + ' / ' + w.fails], ['Funded accounts blown', String(w.blown)], ['Payouts', String(w.payouts)],
                ['Pass rate, any start day', ro.passRate == null ? '-' : pct(ro.passRate) + (ro.medPassDays ? ', median ' + ro.medPassDays + ' days' : '')],
                ['Funded paid before blowing', ro.payRate == null ? '-' : pct(ro.payRate) + (ro.medFirstPay ? ', median ' + ro.medFirstPay + ' days to the 1st payout' : '')]];
      } else {
        var p = r.personal; rows = [['Net', money(r.net)], ['Ending balance', money(p.end)], ['Refills', String(p.refills)], ['Biggest drop', money(-p.drop)]];
      }
      var dl = el('dl', { cls: 'met' }); rows.forEach(function (x) { dl.appendChild(el('div', null, [el('dt', { text: x[0] }), el('dd', { text: x[1] })])); });
      var head = el('div', { cls: 'ch' }, [el('span', { cls: 'sym', text: (i + 1) + '. ' + r.name }), el('span', { cls: 'px ' + (r.net >= 0 ? 'up' : 'dn'), text: money(r.net) })]);
      var kids = [head, dl, el('p', { cls: 'asof', text: r.note })];
      if (r.kind === 'prop' && r.walk.log.length) {
        var det = el('details', null, [el('summary', { text: 'What happened, step by step' })]); var ul = el('ul', { cls: 'dlog' });
        r.walk.log.forEach(function (x) { ul.appendChild(el('li', { text: x[1] + ': ' + x[0] })); }); det.appendChild(ul); kids.push(det);
      }
      if (r.kind === 'prop') kids.push(el('label', { cls: 'dpl' }, ['Price you pay ', el('input', { cls: 'dprice', 'data-id': r.id, value: String(r.price), inputmode: 'decimal', onchange: runOpt })]));
      O.appendChild(el('div', { cls: 'card' }, kids));
    });
  }

  /* ---------------- wire up ---------------- */
  function exportCSV() {
    var cols = ['date', 'tin', 'tout', 'symbol', 'kind', 'side', 'qty', 'entry', 'exit', 'pnl', 'fees', 'account', 'setup', 'grade', 'notes'];
    var esc = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var csv = [cols.join(',')].concat(ALL.map(function (t) { return cols.map(function (c) { return esc(t[c]); }).join(','); })).join('\n');
    var a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'trade_diary.csv' }); document.body.appendChild(a); a.click(); a.remove();
  }
  function authUI() {
    var A = $('#dauth'); A.textContent = '';
    if (!Store.sb) { A.appendChild(el('p', { cls: 'dnote', text: 'Saved in this browser only, on this device. Cloud accounts (sign in from any device) are coming. Use Export to keep a backup.' })); return; }
    if (Store.user) {
      A.appendChild(el('p', { cls: 'dnote' }, ['Signed in as ', el('b', { text: Store.user.email || '' }), '. Only you can see your trades; the site admin can view them for support. Other traders never see them. ',
        el('button', { cls: 'lnk', text: 'Sign out', onclick: function () { Store.signOut(); } }), Store.admin ? el('a', { href: (window.DIARY_BASE || '') + '/diary/admin/', text: '  Admin view' }) : null]));
      var loc = Store.local();
      if (loc.length) A.appendChild(el('p', { cls: 'dnote' }, [loc.length + ' trades are saved on this device from before you signed in. ',
        el('button', { cls: 'btn', text: 'Move them to my account', onclick: function () { Store.add(loc).then(function () { Store.saveLocal([]); alertBox('Moved ' + loc.length + ' trades.', true); load(); authUI(); }).catch(function (e) { alertBox(e.message || String(e)); }); } })]));
      return;
    }
    var inp = el('input', { type: 'email', placeholder: 'you@email.com', autocomplete: 'email' });
    A.appendChild(el('div', { cls: 'card dsign' }, [el('b', { text: 'Sign in to save your diary on any device' }),
      el('p', { cls: 'dnote', text: 'We email you a sign-in link, no password. Only you can see your trades; the site admin can view them for support. Other traders never see them. Until you sign in, trades stay in this browser.' }),
      el('div', { cls: 'drow' }, [inp, el('button', { cls: 'btn', text: 'Email me a link', onclick: function () { if (!inp.value) return; Store.signIn(inp.value.trim()).then(function (r) { if (r.error) throw r.error; alertBox('Check your email for the sign-in link.', true); }).catch(function (e) { alertBox(e.message || String(e)); }); } })])]));
  }
  function wire() {
    $$('.dtabs button').forEach(function (b) { b.addEventListener('click', function () { tab(b.dataset.t); }); });
    ['ffrom', 'fto', 'facct'].forEach(function (id) { $('#' + id).addEventListener('change', filter); });
    var f = $('#dform');
    f.addEventListener('input', function () { var t = formTrade(); $('#dpnlhint').textContent = (num(f.elements.pnl.value) == null && t.pnl != null) ? 'P&L will be ' + money(t.pnl, 2) + ' (before fees)' : ''; });
    f.addEventListener('submit', function (ev) {
      ev.preventDefault(); var t = formTrade();
      if (!t.date || !t.symbol) return alertBox('Date and symbol are needed.');
      if (t.pnl == null) return alertBox('Enter the P&L, or entry, exit and quantity for a futures symbol.');
      var p = editing ? (t.id = editing.id, Store.update(t)) : Store.add([t]);
      p.then(function () { alertBox(editing ? 'Saved.' : 'Trade added.', true); resetForm(); return load(); }).catch(function (e) { alertBox(e.message || String(e)); });
    });
    $('#ddel').addEventListener('click', function () { if (!editing) return; Store.remove([editing.id]).then(function () { alertBox('Trade deleted.', true); resetForm(); return load(); }).catch(function (e) { alertBox(e.message || String(e)); }); });
    $('#dcancel').addEventListener('click', resetForm);
    $('#dfile').addEventListener('change', function (ev) {
      var file = ev.target.files[0]; if (!file) return;
      file.text().then(function (txt) { var tr = importRows(parseCSV(txt)); if (!tr.length) throw new Error('No trades found in that file.'); return Store.add(tr).then(function () { alertBox('Imported ' + tr.length + ' trades.', true); return load(); }); })
        .catch(function (e) { alertBox(e.message || String(e)); }).then(function () { ev.target.value = ''; });
    });
    $('#dexport').addEventListener('click', exportCSV);
    $('#pbal').addEventListener('change', runOpt); $('#psize').addEventListener('change', runOpt);
    window.addEventListener('resize', function () { chart($('#dchart'), stats(VIEW).dayList); });
  }
  window.Diary = { Store: Store, stats: stats, group: group, insights: insights, byDay: byDay, net: net, money: money, pct: pct, chart: chart, el: el, importRows: importRows, parseCSV: parseCSV, autoPnl: autoPnl };
  if (document.getElementById('diary-app')) {
    document.addEventListener('DOMContentLoaded', function () {
      wire(); resetForm();
      Store.init().catch(function () {}).then(function () { authUI(); return load(); });
    });
  }
})();
