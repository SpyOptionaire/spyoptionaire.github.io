/* Diary admin: reads every trader's rows (the database allows it only for accounts in diary_admins). Read-only. */
(function () {
  'use strict';
  var D = window.Diary, el = D.el, money = D.money, pct = D.pct, S = D.Store, box = document.getElementById('adm');
  function msg(t) { box.textContent = ''; box.appendChild(el('p', { cls: 'dnote', text: t })); }
  function userView(email, trades) {
    var s = D.stats(trades), wrap = el('div');
    wrap.appendChild(el('h2', { text: email }));
    var dl = el('dl', { cls: 'dtiles' });
    [['Net', money(s.net)], ['Trades', String(s.n)], ['Win rate', pct(s.wr)], ['Breakeven', pct(s.be)], ['Biggest drop', money(-s.drop)], ['Trades a day', s.perDay.toFixed(1)]]
      .forEach(function (x) { dl.appendChild(el('div', { cls: 'dt' }, [el('dt', { text: x[0] }), el('dd', { text: x[1] })])); });
    wrap.appendChild(dl);
    var cv = el('canvas', { cls: 'dchart' }); wrap.appendChild(el('div', { cls: 'card' }, [cv]));
    var ul = el('ul', { cls: 'dins' }); D.insights(trades).forEach(function (x) { ul.appendChild(el('li', { text: x })); }); wrap.appendChild(el('div', { cls: 'card' }, [ul]));
    var days = D.byDay(trades).map(function (d) { return { date: d.date, trades: d.trades }; });
    if (days.length >= 10) {
      var res = window.DiaryFirms.optimize(days, {}); var t = el('table', { cls: 'dtab' });
      res.forEach(function (r) { t.appendChild(el('tr', null, [el('td', { text: r.name }), el('td', { cls: r.net >= 0 ? 'up' : 'dn', text: money(r.net) })])); });
      wrap.appendChild(el('div', { cls: 'card' }, [el('div', { cls: 'dk', text: 'Best account for this trader' }), t]));
    }
    setTimeout(function () { D.chart(cv, s.dayList); }, 0);
    return wrap;
  }
  function render(all) {
    box.textContent = '';
    var by = {}; all.forEach(function (t) { var k = t.user_email || t.user_id; (by[k] = by[k] || []).push(t); });
    var keys = Object.keys(by);
    box.appendChild(el('p', { cls: 'dnote', text: keys.length + ' traders, ' + all.length + ' trades.' }));
    var tb = el('tbody'), tab = el('table', { cls: 'dtab dusers' }, [el('thead', null, [el('tr', null, ['Trader', 'Trades', 'Win', 'Net', 'Last trade'].map(function (h) { return el('th', { text: h }); }))]), tb]);
    var detail = el('div');
    keys.map(function (k) { var s = D.stats(by[k]); return { k: k, s: s, last: by[k][by[k].length - 1].date }; }).sort(function (a, b) { return b.s.net - a.s.net; })
      .forEach(function (u) { tb.appendChild(el('tr', { onclick: function () { detail.textContent = ''; detail.appendChild(userView(u.k, by[u.k])); detail.scrollIntoView({ behavior: 'smooth' }); } },
        [el('td', { text: u.k }), el('td', { text: String(u.s.n) }), el('td', { text: pct(u.s.wr) }), el('td', { cls: u.s.net >= 0 ? 'up' : 'dn', text: money(u.s.net) }), el('td', { text: u.last })])); });
    box.appendChild(el('div', { cls: 'card' }, [tab]));
    var g = D.group(all, function (t) { return t.setup; }).filter(function (r) { return r.n >= 10; });
    if (g.length) {
      var st = el('table', { cls: 'dtab' }, [el('thead', null, [el('tr', null, ['Setup, all traders', 'Trades', 'Win', 'Avg', 'Net'].map(function (h) { return el('th', { text: h }); }))])]);
      var sb = el('tbody'); g.forEach(function (r) { sb.appendChild(el('tr', null, [el('td', { text: r.key }), el('td', { text: String(r.n) }), el('td', { text: pct(r.wr) }), el('td', { text: money(r.avg) }), el('td', { cls: r.net >= 0 ? 'up' : 'dn', text: money(r.net) })])); });
      st.appendChild(sb); box.appendChild(el('div', { cls: 'card' }, [st]));
    }
    box.appendChild(detail);
  }
  document.addEventListener('DOMContentLoaded', function () {
    S.init().catch(function () {}).then(function () {
      if (!S.sb) return msg('Cloud accounts are not switched on yet, so there is nothing to show. Each trader\'s diary is in their own browser until then.');
      if (!S.user) return msg('Sign in on the Diary page first, then come back here.');
      if (!S.admin) return msg('This account is not on the admin list.');
      return S.list(true).then(render);
    }).catch(function (e) { msg('Could not load: ' + (e.message || e)); });
  });
})();
