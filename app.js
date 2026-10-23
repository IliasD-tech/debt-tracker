const KEY = 'debt-tracker-v1';

// Starts empty so no personal numbers are stored in the code.
// Add your cards and accounts in the app; they're saved on your device.
const SEED = {
  cards: [],
  accounts: [],
  payments: [],
  budget: { income: 1200, fixed: 130 }
};

let state = load();
state.accountLog = state.accountLog || [];

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : structuredClone(SEED);
  } catch (e) {
    return structuredClone(SEED);
  }
}

function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
  render();
}

const $ = (s) => document.querySelector(s);
const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(Number(n) || 0).toFixed(2);
const uid = () => Math.random().toString(36).slice(2, 9);
const num = (v) => (v === '' || v == null ? 0 : Number(v));

function totalOwed() {
  return state.cards.reduce((s, c) => s + (Number(c.balance) || 0), 0);
}

// Total left each month for debt after fixed bills (minimums plus extra).
function debtBudget() {
  return num(state.budget.income) - num(state.budget.fixed);
}

function totalMinimums() {
  return state.cards.reduce((s, c) => s + num(c.min), 0);
}

// What's left after the minimums; this is the amount that goes to the highest-APR card.
function extraForDebt() {
  return debtBudget() - totalMinimums();
}

// Simulate paying minimums each month plus the budget, extra going to highest APR first.
function simulate(monthly) {
  const cards = state.cards.map((c) => ({ id: c.id, bal: num(c.balance), apr: num(c.apr), min: num(c.min) }));
  const order = [...cards].sort((a, b) => b.apr - a.apr);
  const payoff = {};
  let months = 0;
  let interest = 0;
  while (cards.some((c) => c.bal > 0.005) && months < 360) {
    months++;
    for (const c of cards) {
      const i = c.bal * (c.apr / 100) / 12;
      c.bal += i;
      interest += i;
    }
    let budget = monthly;
    for (const c of cards) {
      if (c.bal <= 0) continue;
      const p = Math.min(c.min, c.bal);
      c.bal -= p;
      budget -= p;
    }
    for (const o of order) {
      const live = cards.find((x) => x.id === o.id);
      if (budget <= 0 || live.bal <= 0) continue;
      const p = Math.min(budget, live.bal);
      live.bal -= p;
      budget -= p;
    }
    for (const c of cards) {
      if (c.bal <= 0.005 && !(c.id in payoff)) payoff[c.id] = months;
    }
  }
  return { months, interest, payoff, finished: months < 360 };
}

function monthLabel(m) {
  const d = new Date();
  d.setMonth(d.getMonth() + m);
  return d.toLocaleString(undefined, { month: 'short', year: 'numeric' });
}

function render() {
  const owed = totalOwed();
  $('#total').textContent = money(owed);
  $('#totalSub').textContent = state.cards.length + ' cards, ' + state.accounts.length + ' accounts';

  // Warnings
  const warns = [];
  state.accounts.forEach((a) => {
    if (Number(a.balance) < 0) warns.push(a.name + ' is overdrawn by ' + money(-a.balance) + '. Move money in to bring it to zero.');
  });
  state.cards.forEach((c) => {
    if (c.limit && c.balance / c.limit >= 0.9) warns.push(c.name + ' is at ' + Math.round((c.balance / c.limit) * 100) + '% of its limit.');
    if (c.due) {
      const days = Math.ceil((new Date(c.due + 'T00:00:00') - new Date()) / 86400000);
      if (days >= 0 && days <= 7 && num(c.min) > 0) warns.push(c.name + ' minimum of ' + money(c.min) + ' due in ' + days + ' day(s).');
    }
  });
  const budget = debtBudget();
  const mins = totalMinimums();
  if (budget < mins) warns.push('Income after fixed bills (' + money(budget) + ') is below the total minimums (' + money(mins) + ').');
  $('#warnings').innerHTML = warns.length
    ? warns.map((w) => '<div class="warn">' + w + '</div>').join('')
    : '<div class="small">No warnings right now.</div>';

  // Accounts
  $('#accounts').innerHTML = state.accounts.map((a) =>
    '<div class="row"><div class="name">' + a.name + '</div>' +
    '<div class="actions"><span class="amt ' + (a.balance < 0 ? 'neg' : '') + '">' + money(a.balance) + '</span>' +
    '<button class="ghost" data-edit-account="' + a.id + '">Edit</button></div></div>'
  ).join('') || '<div class="small">No accounts yet.</div>';

  // Cards
  $('#cards').innerHTML = state.cards.map((c) => {
    const util = c.limit ? ' · ' + Math.round((c.balance / c.limit) * 100) + '% used' : '';
    const due = c.due ? ' · due ' + c.due : '';
    const apr = c.apr ? c.apr + '% APR' : 'APR not set';
    return '<div class="row"><div><div class="name">' + c.name + '</div>' +
      '<div class="sub">' + apr + ' · min ' + money(c.min) + due + util + '</div></div>' +
      '<div class="actions"><span class="amt">' + money(c.balance) + '</span>' +
      '<button class="ghost" data-edit-card="' + c.id + '">Edit</button></div></div>';
  }).join('') || '<div class="small">No cards yet.</div>';

  // Dropdowns
  const cardOpts = state.cards.map((c) => '<option value="' + c.id + '">' + c.name + '</option>').join('');
  $('#payCard').innerHTML = cardOpts;
  $('#payFrom').innerHTML = state.accounts.map((a) => '<option value="' + a.id + '">' + a.name + '</option>').join('');

  // Budget inputs
  $('#income').value = state.budget.income;
  $('#fixed').value = state.budget.fixed;
  $('#minTotal').value = totalMinimums().toFixed(2);
  $('#extraDebt').value = extraForDebt().toFixed(2);

  // Plan: pays minimums first, then the extra, highest APR first.
  const sim = simulate(Math.max(budget, 0));
  if (!state.cards.length) {
    $('#plan').innerHTML = '<div class="small">Add cards to see a payoff plan.</div>';
  } else if (!sim.finished) {
    $('#plan').innerHTML = '<div class="warn">At this budget the balance won\'t clear within 30 years. Increase the monthly amount.</div>';
  } else {
    const rows = state.cards
      .filter((c) => c.balance > 0)
      .sort((a, b) => num(b.apr) - num(a.apr))
      .map((c) => '<div class="row"><div class="name">' + c.name + '</div>' +
        '<div class="amt">' + (c.id in sim.payoff ? 'paid off ' + monthLabel(sim.payoff[c.id]) : '') + '</div></div>')
      .join('');
    $('#plan').innerHTML =
      '<div class="small">Paying ' + money(budget) + ' a month (' + money(totalMinimums()) + ' minimums plus ' +
      money(extraForDebt()) + ' extra). Estimated debt-free in ' + sim.months + ' month(s), about ' +
      money(sim.interest) + ' in interest. Cards with no APR entered are treated as 0%.</div>' + rows;
  }

  // Activity: card payments and debit account activity, newest first
  const history = [
    ...state.payments.map((p) => {
      const card = state.cards.find((c) => c.id === p.cardId);
      const from = state.accounts.find((a) => a.id === p.fromId);
      return { date: p.date, title: card ? card.name : 'Deleted card', sub: 'payment from ' + (from ? from.name : 'unknown'), amount: -num(p.amount) };
    }),
    ...state.accountLog.map((e) => {
      const acct = state.accounts.find((a) => a.id === e.accountId);
      return {
        date: e.date,
        title: acct ? acct.name : 'Deleted account',
        sub: e.note || (e.type === 'in' ? 'deposit' : 'spending'),
        amount: e.type === 'in' ? num(e.amount) : -num(e.amount)
      };
    })
  ].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 25);
  $('#history').innerHTML = history.map((h) =>
    '<div class="row"><div><div class="name">' + h.title + '</div><div class="sub">' + h.date + ' · ' + h.sub + '</div></div>' +
    '<div class="amt ' + (h.amount < 0 ? 'neg' : 'pos') + '">' + money(h.amount) + '</div></div>'
  ).join('') || '<div class="small">No activity logged yet.</div>';
  $('#actAccount').innerHTML = state.accounts.map((a) => '<option value="' + a.id + '">' + a.name + '</option>').join('');
}

// Budget inputs
['#income', '#fixed'].forEach((sel) => {
  $(sel).addEventListener('change', () => {
    state.budget = {
      income: num($('#income').value),
      fixed: num($('#fixed').value)
    };
    save();
  });
});

// Log payment
$('#logPay').addEventListener('click', () => {
  const amount = num($('#payAmt').value);
  const cardId = $('#payCard').value;
  const fromId = $('#payFrom').value;
  if (!amount || !cardId) return;
  const card = state.cards.find((c) => c.id === cardId);
  const from = state.accounts.find((a) => a.id === fromId);
  card.balance = Number((num(card.balance) - amount).toFixed(2));
  if (from) from.balance = Number((num(from.balance) - amount).toFixed(2));
  state.payments.push({ id: uid(), cardId, fromId, amount, date: $('#payDate').value || new Date().toISOString().slice(0, 10) });
  $('#payAmt').value = '';
  save();
});

// Log debit account activity (deposits and spending)
$('#logAct').addEventListener('click', () => {
  const amount = num($('#actAmt').value);
  const accountId = $('#actAccount').value;
  const type = $('#actType').value;
  const acct = state.accounts.find((a) => a.id === accountId);
  if (!amount || !acct) return;
  acct.balance = Number((num(acct.balance) + (type === 'in' ? amount : -amount)).toFixed(2));
  state.accountLog.push({
    id: uid(),
    accountId,
    type,
    amount,
    date: $('#actDate').value || new Date().toISOString().slice(0, 10),
    note: $('#actNote').value.trim()
  });
  $('#actAmt').value = '';
  $('#actNote').value = '';
  save();
});

// Card dialog
let editingCard = null;
function openCard(id) {
  editingCard = id || null;
  const c = state.cards.find((x) => x.id === id) || { name: '', balance: '', apr: '', min: '', due: '', limit: '' };
  $('#cardTitle').textContent = id ? 'Edit card' : 'New card';
  $('#cName').value = c.name;
  $('#cBal').value = c.balance;
  $('#cApr').value = c.apr;
  $('#cMin').value = c.min;
  $('#cDue').value = c.due;
  $('#cLimit').value = c.limit || '';
  $('#cDelete').style.display = id ? '' : 'none';
  $('#cardDialog').showModal();
}
$('#addCard').addEventListener('click', () => openCard(null));
$('#cards').addEventListener('click', (e) => {
  const id = e.target.dataset.editCard;
  if (id) openCard(id);
});
$('#cCancel').addEventListener('click', () => $('#cardDialog').close());
$('#cardForm').addEventListener('submit', () => {
  const data = {
    name: $('#cName').value.trim(),
    balance: num($('#cBal').value),
    apr: num($('#cApr').value),
    min: num($('#cMin').value),
    due: $('#cDue').value,
    limit: num($('#cLimit').value)
  };
  if (editingCard) {
    Object.assign(state.cards.find((c) => c.id === editingCard), data);
  } else {
    state.cards.push({ id: uid(), ...data });
  }
  save();
});
$('#cDelete').addEventListener('click', () => {
  if (!confirm('Delete this card? Payment history will stay.')) return;
  state.cards = state.cards.filter((c) => c.id !== editingCard);
  $('#cardDialog').close();
  save();
});

// Account dialog
let editingAccount = null;
function openAccount(id) {
  editingAccount = id || null;
  const a = state.accounts.find((x) => x.id === id) || { name: '', balance: '' };
  $('#accountTitle').textContent = id ? 'Edit account' : 'New account';
  $('#aName').value = a.name;
  $('#aBal').value = a.balance;
  $('#aDelete').style.display = id ? '' : 'none';
  $('#accountDialog').showModal();
}
$('#addAccount').addEventListener('click', () => openAccount(null));
$('#accounts').addEventListener('click', (e) => {
  const id = e.target.dataset.editAccount;
  if (id) openAccount(id);
});
$('#aCancel').addEventListener('click', () => $('#accountDialog').close());
$('#accountForm').addEventListener('submit', () => {
  const data = { name: $('#aName').value.trim(), balance: num($('#aBal').value) };
  if (editingAccount) {
    Object.assign(state.accounts.find((a) => a.id === editingAccount), data);
  } else {
    state.accounts.push({ id: uid(), ...data });
  }
  save();
});
$('#aDelete').addEventListener('click', () => {
  if (!confirm('Delete this account?')) return;
  state.accounts = state.accounts.filter((a) => a.id !== editingAccount);
  $('#accountDialog').close();
  save();
});

// Export / import
$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'debt-tracker-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
});
$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.cards) || !Array.isArray(data.accounts)) throw new Error('Not a debt tracker file');
    state = data;
    state.accountLog = data.accountLog || [];
    save();
  } catch (err) {
    alert('Could not import: ' + err.message);
  }
});

// Default payment date to today
$('#payDate').value = new Date().toISOString().slice(0, 10);
$('#actDate').value = new Date().toISOString().slice(0, 10);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
