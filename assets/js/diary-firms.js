/* SpyOptionaire trade diary: prop firm optimizer.
   Replays a trader's own closed trades (net $ per trade, in order, grouped by trading day) through each firm's 50K rules and a personal
   account. Runs in the browser on the trader's own data; nothing is sent anywhere.
   Rules as checked Oct-Nov 2026 (firms change them often; prices are list prices and editable on the page).
   Limits: checked at trade closes only (no intraday swings inside a trade), contract limits not enforced. */
(function (root) {
  'use strict';
  var START = 50000;
  var PLANS = [
    { id: 'fnf_flex', name: 'FundedNext Flex 50K', price: 79.99,
      eval: { target: 2500, dd: 1500, trail: 'eod', lockAt: 100, cons: 0.40, minDays: 3, dll: 0 },
      funded: { dd: 1500, trail: 'eod', lockAt: 100, dll: 0, qualDay: 200, qualDays: 5, cycleMin: 500, rule: 'pct', pct: 0.5, cap: 1500, min: 250, maxPayouts: 5, split: 0.95 },
      note: 'Eval: $2,500 target, $1,500 end-of-day trailing, 40% consistency, 3 days. Funded: 5 days of $200+, $500 in the cycle, 50% of profit up to $1,500, 95% split, 5 payouts then the account ends.' },
    { id: 'tfy_select', name: 'Tradeify Select 50K (Flex funded)', price: 165,
      eval: { target: 3000, dd: 2000, trail: 'eod', lockAt: 100, cons: 0.40, minDays: 3, dll: 0 },
      funded: { dd: 2000, trail: 'eod', lockAt: 100, dll: 0, qualDay: 150, qualDays: 5, cycleMin: 0.01, rule: 'pct', pct: 0.5, cap: 2500, min: 250, maxPayouts: 3, split: 0.90 },
      note: 'Eval: $3,000 target, $2,000 end-of-day trailing, 40% consistency, 3 days. Funded Flex: 5 days of $150+, cycle positive, 50% of profit up to $2,500, 90% split. Counted to 3 payouts (Elite Live review).' },
    { id: 'tfy_growth', name: 'Tradeify Growth 50K', price: 145,
      eval: { target: 3000, dd: 2000, trail: 'eod', lockAt: 100, cons: 0, minDays: 1, dll: 1250 },
      funded: { dd: 2000, trail: 'eod', lockAt: 100, dll: 1250, qualDay: 150, qualDays: 5, minProfit: 3000, cycleCons: 0.35, rule: 'tiers', tiers: [1500, 2000, 2500, 3000], min: 500, maxPayouts: 3, split: 0.90 },
      note: 'Eval: $3,000 target, $2,000 end-of-day trailing, $1,250 daily loss limit, 1 day. Funded: balance $53,000+, 5 days of $150+, best day no more than 35% of the cycle, payouts $1,500 / $2,000 / $2,500, 90% split.' },
    { id: 'mffu_rapid', name: 'MyFundedFutures Rapid 50K', price: 157,
      eval: { target: 3000, dd: 2000, trail: 'eod', lockAt: 100, cons: 0.50, minDays: 2, dll: 0 },
      funded: { dd: 2000, trail: 'intraday', lockAt: 100, dll: 0, rule: 'buffer', buffer: 2100, min: 500, cap: 0, maxPayouts: 5, split: 0.90 },
      note: 'Eval: $3,000 target, $2,000 end-of-day trailing, 50% consistency, 2 days. Funded: $2,000 trailing on the balance, withdraw anything over a $2,100 buffer (min $500), 90% split. Counted to 5 payouts.' },
    { id: 'fnf_direct', name: 'FundedNext Direct 50K (no eval)', price: 660,
      eval: null,
      funded: { dd: 2000, trail: 'eod', lockAt: 100, dll: 1000, everCons: 0.20, rule: 'buffer', buffer: 2100, min: 800, cap: 1200, minCycleDays: 5, maxPayouts: 5, split: 0.90 },
      note: 'No eval. $2,000 end-of-day trailing, $1,000 daily loss limit, best day ever no more than 20% of the cycle profit, withdraw over a $2,100 buffer ($800 - $1,200), 90% split, 5 payouts.' }
  ];

  /* days: [{date, trades:[net $ ...]}] in date order */
  function dayRun(trades, dll) {           // -> {pnl, low, high} for one day, soft daily loss limit applied at trade closes
    var p = 0, lo = 0, hi = 0;
    for (var i = 0; i < trades.length; i++) {
      p += trades[i];
      if (dll && p <= -dll) { p = -dll; lo = Math.min(lo, p); break; }
      lo = Math.min(lo, p); hi = Math.max(hi, p);
    }
    return { pnl: p, low: lo, high: hi, path: trades };
  }
  function breached(day, bal, floor, dll, trail, peakRef) {
    // walks the trades of a day; returns true if the balance touches the floor at a trade close.
    var p = 0;
    for (var i = 0; i < day.trades.length; i++) {
      p += day.trades[i];
      if (dll && p <= -dll) p = -dll;
      if (trail === 'intraday' && !peakRef.locked) {
        peakRef.peak = Math.max(peakRef.peak, bal + p);
        floor = peakRef.floorOf(peakRef.peak);
      }
      if (bal + p <= floor + 1e-9) return true;
      if (dll && p <= -dll) break;
    }
    return false;
  }
  function trailer(start, dd, lockAt) {
    var lockPeak = start + dd + lockAt;
    var o = { peak: start, locked: false, floor: start - dd };
    o.floorOf = function (pk) { return pk >= lockPeak ? start + lockAt : pk - dd; };
    o.eod = function (bal) {
      if (o.locked) return;
      o.peak = Math.max(o.peak, bal); o.floor = o.floorOf(o.peak); if (o.peak >= lockPeak) o.locked = true;
    };
    o.lock = function () { o.floor = start + lockAt; o.locked = true; };
    return o;
  }

  function simEval(days, i0, e) {
    var bal = START, tr = trailer(START, e.dd, e.lockAt), best = 0, n = 0;
    for (var k = i0; k < days.length; k++) {
      var d = dayRun(days[k].trades, e.dll);
      if (breached(days[k], bal, tr.floor, e.dll, 'eod', tr)) return { res: 'fail', end: k, days: k - i0 + 1 };
      bal += d.pnl; n++; best = Math.max(best, d.pnl); tr.eod(bal);
      var prof = bal - START;
      if (prof >= e.target && n >= e.minDays && (!e.cons || best <= e.cons * prof + 1e-9)) return { res: 'pass', end: k, days: k - i0 + 1 };
    }
    return { res: 'open', end: days.length - 1, days: days.length - i0 };
  }

  function simFunded(days, i0, f) {
    var bal = START, tr = trailer(START, f.dd, f.lockAt), paid = 0, gross = 0, npay = 0, qual = 0, cyc0 = START, cbest = 0, ebest = 0, cdays = 0, first = -1;
    for (var k = i0; k < days.length; k++) {
      var d = dayRun(days[k].trades, f.dll);
      if (breached(days[k], bal, tr.floor, f.dll, f.trail, tr)) return { res: 'blown', end: k, days: k - i0 + 1, paid: paid, gross: gross, payouts: npay, first: first };
      bal += d.pnl; cdays++;
      if (f.trail === 'eod') tr.eod(bal); else if (!tr.locked) { tr.peak = Math.max(tr.peak, bal); tr.floor = tr.floorOf(tr.peak); if (tr.peak >= START + f.dd + f.lockAt) tr.lock(); }
      if (f.qualDay && d.pnl >= f.qualDay) qual++;
      cbest = Math.max(cbest, d.pnl); ebest = Math.max(ebest, d.pnl);
      var prof = bal - START, cyc = bal - cyc0, amt = 0;
      if (f.rule === 'pct') {
        if (qual >= f.qualDays && cyc >= (f.cycleMin || 0)) { amt = Math.min(f.pct * prof, f.cap); if (amt < f.min) amt = 0; }
      } else if (f.rule === 'tiers') {
        if (prof >= f.minProfit && qual >= f.qualDays && cbest <= f.cycleCons * cyc + 1e-9) amt = f.tiers[Math.min(npay, f.tiers.length - 1)];
        if (amt && bal - amt < tr.floor) amt = 0;
      } else if (f.rule === 'buffer') {
        var ok = prof - f.buffer >= f.min && (!f.minCycleDays || cdays >= f.minCycleDays) && (!f.everCons || ebest <= f.everCons * cyc + 1e-9);
        if (ok) { amt = prof - f.buffer; if (f.cap) amt = Math.min(amt, f.cap); }
      }
      if (amt > 0) {
        bal -= amt; gross += amt; paid += amt * f.split; npay++; if (first < 0) first = k - i0 + 1;
        qual = 0; cbest = 0; cyc0 = bal; cdays = 0; tr.lock();
        if (npay >= f.maxPayouts) return { res: 'done', end: k, days: k - i0 + 1, paid: paid, gross: gross, payouts: npay, first: first };
      }
    }
    return { res: 'open', end: days.length - 1, days: days.length - i0, paid: paid, gross: gross, payouts: npay, first: first };
  }

  /* walk the whole history the way a trader would: buy an eval, if it fails buy another the next day, when it passes trade the funded
     account until it blows or ends, then start over. One account at a time. */
  function walk(days, plan, price) {
    var i = 0, evals = 0, passes = 0, fails = 0, funded = 0, blown = 0, payouts = 0, paid = 0, fees = 0, firstPay = -1, log = [];
    while (i < days.length) {
      if (plan.eval) {
        evals++; fees += price;
        var e = simEval(days, i, plan.eval);
        if (e.res === 'fail') { fails++; log.push(['Eval failed', days[e.end].date]); i = e.end + 1; continue; }
        if (e.res === 'open') { log.push(['Eval still open', days[e.end].date]); break; }
        passes++; log.push(['Eval passed', days[e.end].date]); i = e.end + 1;
        if (i >= days.length) break;
      } else { funded++; fees += price; }
      if (plan.eval) funded++;
      var f = simFunded(days, i, plan.funded);
      payouts += f.payouts; paid += f.paid;
      if (f.first > 0 && firstPay < 0) firstPay = (i - 0) + f.first;
      if (f.payouts) log.push([f.payouts + (f.payouts > 1 ? ' payouts' : ' payout') + ', $' + Math.round(f.paid).toLocaleString() + ' to you', days[f.end].date]);
      if (f.res === 'blown') { blown++; log.push(['Funded account blown', days[f.end].date]); i = f.end + 1; continue; }
      if (f.res === 'done') { log.push(['Account finished (payout limit)', days[f.end].date]); i = f.end + 1; continue; }
      break;
    }
    return { evals: evals, passes: passes, fails: fails, funded: funded, blown: blown, payouts: payouts, paid: paid, fees: fees, net: paid - fees, firstPay: firstPay, log: log };
  }

  function rolling(days, plan) {
    // a fresh eval (or funded account for no-eval plans) started on every trading day
    var ev = [], fd = [];
    for (var s = 0; s < days.length; s++) {
      if (plan.eval) { var e = simEval(days, s, plan.eval); if (e.res !== 'open') ev.push(e); }
      var f = simFunded(days, s, plan.funded); if (f.res !== 'open' || f.payouts) fd.push(f);
    }
    var pass = ev.filter(function (x) { return x.res === 'pass'; });
    var dd = pass.map(function (x) { return x.days; }).sort(function (a, b) { return a - b; });
    var paidAny = fd.filter(function (x) { return x.payouts > 0; });
    var fp = paidAny.map(function (x) { return x.first; }).sort(function (a, b) { return a - b; });
    return {
      evalStarts: ev.length, passRate: ev.length ? pass.length / ev.length : null, medPassDays: dd.length ? dd[Math.floor(dd.length / 2)] : null,
      fundedStarts: fd.length, payRate: fd.length ? paidAny.length / fd.length : null, medFirstPay: fp.length ? fp[Math.floor(fp.length / 2)] : null,
      avgPaid: fd.length ? fd.reduce(function (a, x) { return a + x.paid; }, 0) / fd.length : null
    };
  }

  function personal(days, startBal, sizePct) {
    var bal = startBal, dep = startBal, refills = 0, peak = startBal, drop = 0, f = sizePct / 100;
    for (var k = 0; k < days.length; k++) {
      for (var i = 0; i < days[k].trades.length; i++) {
        bal += days[k].trades[i] * f;
        peak = Math.max(peak, bal); drop = Math.max(drop, peak - bal);
        if (bal <= startBal * 0.2) { refills++; dep += startBal - bal; bal = startBal; peak = bal; }
      }
    }
    return { end: bal, deposited: dep, refills: refills, net: bal - dep, drop: drop };
  }

  function optimize(days, opts) {
    opts = opts || {};
    var out = [];
    PLANS.forEach(function (p) {
      var price = (opts.prices && opts.prices[p.id] != null) ? opts.prices[p.id] : p.price;
      var w = walk(days, p, price), r = rolling(days, p);
      out.push({ id: p.id, name: p.name, note: p.note, price: price, walk: w, roll: r, net: w.net, kind: 'prop' });
    });
    var pb = opts.personalBalance || 2500, ps = opts.personalSize || 100, pr = personal(days, pb, ps);
    out.push({ id: 'personal', name: 'Personal account ($' + pb.toLocaleString() + ' at ' + ps + '% of your size)', net: pr.net, personal: pr, kind: 'personal',
               note: 'Your trades at ' + ps + '% of the size you took them, in your own account. Refilled to $' + pb.toLocaleString() + ' if it falls under 20% of that.' });
    out.sort(function (a, b) { return b.net - a.net; });
    return out;
  }

  root.DiaryFirms = { PLANS: PLANS, simEval: simEval, simFunded: simFunded, walk: walk, rolling: rolling, personal: personal, optimize: optimize };
})(typeof window !== 'undefined' ? window : globalThis);
