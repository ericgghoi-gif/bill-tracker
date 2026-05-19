(function () {
  'use strict';

  // ─── CONSTANTS ────────────────────────────────────────────────────────────
  const STORAGE_BILLS    = 'bt_bills';
  const STORAGE_PAYMENTS = 'bt_payments';
  const CATEGORIES       = ['Housing', 'Utilities', 'Subscriptions', 'Insurance', 'Loans', 'Other'];
  const ALARM_DAYS       = 3;

  // ─── STATE ────────────────────────────────────────────────────────────────
  let bills        = [];
  let payments     = [];
  let activeTab    = 'bills';
  let trackerYear  = 0;
  let trackerMonth = 0;

  // ─── STORAGE ──────────────────────────────────────────────────────────────
  function loadData() {
    try {
      bills    = JSON.parse(localStorage.getItem(STORAGE_BILLS)    || '[]');
      payments = JSON.parse(localStorage.getItem(STORAGE_PAYMENTS) || '[]');
    } catch (e) {
      bills    = [];
      payments = [];
    }
  }

  function saveBills()    { localStorage.setItem(STORAGE_BILLS,    JSON.stringify(bills));    }
  function savePayments() { localStorage.setItem(STORAGE_PAYMENTS, JSON.stringify(payments)); }

  // ─── ID GENERATION ────────────────────────────────────────────────────────
  function genId() {
    return (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  // ─── DATA HELPERS (pure) ──────────────────────────────────────────────────
  function toMonthKey(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
  }

  function parseMonthKey(key) {
    const parts = key.split('-');
    return { year: Number(parts[0]), month: Number(parts[1]) - 1 };
  }

  function getBillsForMonth() {
    return bills.filter(function (b) { return b.active; });
  }

  function getPayment(billId, monthKey) {
    return payments.find(function (p) { return p.billId === billId && p.month === monthKey; }) || null;
  }

  function getSortedPayments() {
    return payments.slice().sort(function (a, b) { return b.paidDate.localeCompare(a.paidDate); });
  }

  function formatMoney(n) {
    return '$' + Number(n).toFixed(2);
  }

  function formatDateStr(str) {
    const parts = str.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2])
      .toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatMonth(year, month) {
    return new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  function getUpcoming(days) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var limit = new Date(today); limit.setDate(limit.getDate() + days);
    var results = [];
    bills.filter(function (b) { return b.active; }).forEach(function (bill) {
      [-1, 0, 1].forEach(function (offset) {
        var d = new Date(today.getFullYear(), today.getMonth() + offset, bill.dueDay);
        if (d >= today && d <= limit) results.push({ bill: bill, dueDate: d });
      });
    });
    results.sort(function (a, b) { return a.dueDate - b.dueDate; });
    return results;
  }

  function getLastNMonths(n) {
    var result = [];
    var d = new Date();
    for (var i = n - 1; i >= 0; i--) {
      var ref = new Date(d.getFullYear(), d.getMonth() - i, 1);
      result.push(toMonthKey(ref));
    }
    return result;
  }

  function getMonthlyTotals(monthKeys) {
    var map = {};
    monthKeys.forEach(function (k) { map[k] = 0; });
    payments.forEach(function (p) {
      if (p.month in map) map[p.month] += Number(p.amount);
    });
    return map;
  }

  function getCategoryTotals(monthKey) {
    var map = {};
    CATEGORIES.forEach(function (c) { map[c] = 0; });
    payments
      .filter(function (p) { return p.month === monthKey; })
      .forEach(function (p) {
        var bill = bills.find(function (b) { return b.id === p.billId; });
        if (bill) map[bill.category] = (map[bill.category] || 0) + Number(p.amount);
      });
    return map;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── BILL CRUD ────────────────────────────────────────────────────────────
  function addBill(data) {
    bills.push(Object.assign({ id: genId() }, data));
    saveBills();
    renderBillsTable();
  }

  function updateBill(id, data) {
    var idx = bills.findIndex(function (b) { return b.id === id; });
    if (idx < 0) return;
    bills[idx] = Object.assign({}, bills[idx], data);
    saveBills();
    renderBillsTable();
  }

  function deleteBill(id) {
    if (!confirm('Delete this bill? Payment history for this bill will be kept.')) return;
    bills = bills.filter(function (b) { return b.id !== id; });
    saveBills();
    renderBillsTable();
    renderTracker();
  }

  // ─── PAYMENT CRUD ─────────────────────────────────────────────────────────
  function markPaid(billId, month, paidDate, amount) {
    if (getPayment(billId, month)) return;
    payments.push({ id: genId(), billId: billId, month: month, paidDate: paidDate, amount: Number(amount) });
    savePayments();
    renderTracker();
    if (activeTab === 'analysis') renderAnalysis();
  }

  function unmarkPaid(billId, month) {
    payments = payments.filter(function (p) { return !(p.billId === billId && p.month === month); });
    savePayments();
    renderTracker();
    if (activeTab === 'analysis') renderAnalysis();
  }

  // ─── RENDER: BILLS TAB ────────────────────────────────────────────────────
  function renderBillsTable() {
    var tbody = document.getElementById('billsTableBody');
    var empty = document.getElementById('billsEmpty');
    tbody.innerHTML = '';

    if (bills.length === 0) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    bills.forEach(function (bill) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + escHtml(bill.name) + '</td>' +
        '<td>' + formatMoney(bill.amount) + '</td>' +
        '<td>' + bill.dueDay + '</td>' +
        '<td><span class="badge badge--' + bill.category.toLowerCase() + '">' + bill.category + '</span></td>' +
        '<td><span class="status-dot ' + (bill.active ? 'active' : 'inactive') + '">' +
          (bill.active ? 'Active' : 'Paused') + '</span></td>' +
        '<td class="row-actions">' +
          '<button class="btn btn--sm btn--ghost edit-bill-btn" data-id="' + bill.id + '">Edit</button>' +
          '<button class="btn btn--sm btn--danger delete-bill-btn" data-id="' + bill.id + '">Delete</button>' +
        '</td>';
      tbody.appendChild(tr);
    });
  }

  // ─── RENDER: TRACKER TAB ──────────────────────────────────────────────────
  function renderTracker() {
    var monthKey = toMonthKey(new Date(trackerYear, trackerMonth, 1));
    document.getElementById('monthLabel').textContent = formatMonth(trackerYear, trackerMonth);

    var tbody      = document.getElementById('trackerTableBody');
    var emptyMsg   = document.getElementById('trackerEmpty');
    tbody.innerHTML = '';

    var activeBills = getBillsForMonth();
    if (activeBills.length === 0) {
      emptyMsg.hidden = false;
      document.getElementById('trackerSummary').innerHTML = '';
      return;
    }
    emptyMsg.hidden = true;

    var totalPaid = 0;
    var totalDue  = 0;

    activeBills.forEach(function (bill) {
      var payment = getPayment(bill.id, monthKey);
      var isPaid  = !!payment;
      totalDue += Number(bill.amount);
      if (isPaid) totalPaid += Number(payment.amount);

      var dueDateStr = trackerYear + '-' +
        String(trackerMonth + 1).padStart(2, '0') + '-' +
        String(bill.dueDay).padStart(2, '0');

      var tr = document.createElement('tr');
      if (isPaid) tr.classList.add('row--paid');
      tr.innerHTML =
        '<td>' + escHtml(bill.name) + '</td>' +
        '<td><span class="badge badge--' + bill.category.toLowerCase() + '">' + bill.category + '</span></td>' +
        '<td>' + formatDateStr(dueDateStr) + '</td>' +
        '<td>' + formatMoney(bill.amount) + '</td>' +
        '<td>' + (isPaid
          ? '<span class="pill pill--paid">Paid ' + formatDateStr(payment.paidDate) + '</span>'
          : '<span class="pill pill--unpaid">Unpaid</span>') + '</td>' +
        '<td>' + (isPaid
          ? '<button class="btn btn--sm btn--ghost unpay-btn" data-bill-id="' + bill.id + '" data-month="' + monthKey + '">Undo</button>'
          : '<button class="btn btn--sm btn--accent pay-btn" data-bill-id="' + bill.id + '" data-month="' + monthKey + '">Mark Paid</button>') + '</td>';
      tbody.appendChild(tr);
    });

    var remaining = totalDue - totalPaid;
    document.getElementById('trackerSummary').innerHTML =
      '<span class="summary-item">Paid: <strong class="txt--success">' + formatMoney(totalPaid) + '</strong></span>' +
      '<span class="summary-sep">|</span>' +
      '<span class="summary-item">Remaining: <strong class="txt--accent">' + formatMoney(remaining) + '</strong></span>' +
      '<span class="summary-sep">|</span>' +
      '<span class="summary-item">Total: <strong>' + formatMoney(totalDue) + '</strong></span>';
  }

  // ─── RENDER: ANALYSIS TAB ─────────────────────────────────────────────────
  function renderAnalysis() {
    renderMonthlyChart();
    renderCategoryChart();
    renderUpcoming();
    renderHistoryTable();
  }

  function renderMonthlyChart() {
    var container = document.getElementById('monthlyChart');
    container.innerHTML = '';
    var monthKeys = getLastNMonths(6);
    var totals    = getMonthlyTotals(monthKeys);
    var maxVal    = Math.max.apply(null, Object.values(totals).concat([1]));

    monthKeys.forEach(function (key) {
      var val  = totals[key];
      var pct  = Math.round((val / maxVal) * 100);
      var info = parseMonthKey(key);
      var label = new Date(info.year, info.month, 1)
        .toLocaleDateString('en-US', { month: 'short' });

      var wrap = document.createElement('div');
      wrap.className = 'vbar-wrap';
      wrap.innerHTML =
        '<span class="vbar-value">' + formatMoney(val) + '</span>' +
        '<div class="vbar" style="--pct:' + pct + '%"></div>' +
        '<span class="vbar-label">' + label + '</span>';
      container.appendChild(wrap);
    });
  }

  function renderCategoryChart() {
    var container = document.getElementById('categoryChart');
    container.innerHTML = '';
    var monthKey = toMonthKey(new Date(trackerYear, trackerMonth, 1));
    document.getElementById('categorySubtitle').textContent = '— ' + formatMonth(trackerYear, trackerMonth);

    var totals = getCategoryTotals(monthKey);
    var maxVal = Math.max.apply(null, Object.values(totals).concat([1]));

    CATEGORIES.forEach(function (cat) {
      var val = totals[cat] || 0;
      var pct = Math.round((val / maxVal) * 100);
      var row = document.createElement('div');
      row.className = 'hbar-row';
      row.innerHTML =
        '<span class="hbar-label">' + cat + '</span>' +
        '<div class="hbar-track"><div class="hbar-fill" style="--pct:' + pct + '%"></div></div>' +
        '<span class="hbar-value">' + formatMoney(val) + '</span>';
      container.appendChild(row);
    });
  }

  function renderUpcoming() {
    var list = document.getElementById('dueList');
    list.innerHTML = '';
    var upcoming = getUpcoming(30);

    if (upcoming.length === 0) {
      list.innerHTML = '<li class="empty-cell">No bills due in the next 30 days.</li>';
      return;
    }

    var today = new Date(); today.setHours(0, 0, 0, 0);
    upcoming.forEach(function (item) {
      var diff  = Math.round((item.dueDate - today) / 86400000);
      var when  = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : 'In ' + diff + ' days';
      var dateLabel = item.dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      var urgent = diff <= 3 ? 'due-item--urgent' : '';

      // Check if already paid this month
      var mKey    = toMonthKey(item.dueDate);
      var isPaid  = !!getPayment(item.bill.id, mKey);

      var li = document.createElement('li');
      li.className = 'due-item ' + urgent + (isPaid ? ' due-item--paid' : '');
      li.innerHTML =
        '<span class="due-name">' + escHtml(item.bill.name) + '</span>' +
        '<span class="due-when">' + when + ' · ' + dateLabel + '</span>' +
        '<span class="due-amount">' + formatMoney(item.bill.amount) + '</span>' +
        (isPaid ? '<span class="pill pill--paid pill--sm">Paid</span>' : '');
      list.appendChild(li);
    });
  }

  function renderHistoryTable() {
    var tbody  = document.getElementById('historyTableBody');
    tbody.innerHTML = '';
    var sorted = getSortedPayments();

    if (sorted.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">No payments recorded yet.</td></tr>';
      return;
    }

    sorted.forEach(function (p) {
      var bill = bills.find(function (b) { return b.id === p.billId; });
      var name = bill ? escHtml(bill.name) : '<em>(deleted bill)</em>';
      var cat  = bill ? bill.category : '—';
      var tr   = document.createElement('tr');
      tr.innerHTML =
        '<td>' + formatDateStr(p.paidDate) + '</td>' +
        '<td>' + name + '</td>' +
        '<td><span class="badge badge--' + cat.toLowerCase() + '">' + cat + '</span></td>' +
        '<td>' + formatMoney(p.amount) + '</td>' +
        '<td>' + p.month + '</td>';
      tbody.appendChild(tr);
    });
  }

  // ─── MODAL: BILL ──────────────────────────────────────────────────────────
  function openBillModal(editId) {
    var form = document.getElementById('billForm');
    form.reset();
    document.getElementById('billEditId').value = editId || '';
    document.getElementById('modalTitle').textContent = editId ? 'Edit Bill' : 'Add Bill';

    if (editId) {
      var bill = bills.find(function (b) { return b.id === editId; });
      if (!bill) return;
      document.getElementById('billName').value     = bill.name;
      document.getElementById('billAmount').value   = bill.amount;
      document.getElementById('billDueDay').value   = bill.dueDay;
      document.getElementById('billCategory').value = bill.category;
      document.getElementById('billActive').checked = bill.active;
    }

    document.getElementById('billModal').hidden = false;
    document.getElementById('billName').focus();
  }

  function closeBillModal() {
    document.getElementById('billModal').hidden = true;
  }

  // ─── MODAL: PAY ───────────────────────────────────────────────────────────
  function openPayModal(billId, month) {
    document.getElementById('payBillId').value = billId;
    document.getElementById('payMonth').value  = month;
    document.getElementById('payDate').value   = new Date().toISOString().slice(0, 10);
    var bill = bills.find(function (b) { return b.id === billId; });
    if (bill) document.getElementById('payAmount').value = bill.amount;
    document.getElementById('payModal').hidden = false;
    document.getElementById('payDate').focus();
  }

  function closePayModal() {
    document.getElementById('payModal').hidden = true;
  }

  // ─── ICS EXPORT ───────────────────────────────────────────────────────────
  function generateICS() {
    var CRLF = '\r\n';
    var now  = new Date();

    function fold(line) {
      if (line.length <= 75) return line;
      var out = '';
      while (line.length > 75) {
        out  += line.slice(0, 75) + CRLF + ' ';
        line  = line.slice(75);
      }
      return out + line;
    }

    function icsDate(date) {
      return date.getFullYear() +
        String(date.getMonth() + 1).padStart(2, '0') +
        String(date.getDate()).padStart(2, '0');
    }

    function icsDTSTAMP() {
      return now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    }

    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Bill Tracker//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Bill Tracker',
    ];

    var activeBills = bills.filter(function (b) { return b.active; });

    for (var offset = 0; offset < 12; offset++) {
      var totalMonths = now.getMonth() + offset;
      var eventYear   = now.getFullYear() + Math.floor(totalMonths / 12);
      var eventMonth  = totalMonths % 12;

      activeBills.forEach(function (bill) {
        var dueDate = new Date(eventYear, eventMonth, bill.dueDay);
        var uid     = bill.id + '-' + eventYear + '-' + String(eventMonth + 1).padStart(2, '0') + '@bill-tracker';
        var summary = bill.name + ' due - ' + formatMoney(bill.amount);

        lines.push('BEGIN:VEVENT');
        lines.push(fold('UID:' + uid));
        lines.push('DTSTAMP:' + icsDTSTAMP());
        lines.push('DTSTART;VALUE=DATE:' + icsDate(dueDate));
        lines.push('DTEND;VALUE=DATE:' + icsDate(dueDate));
        lines.push(fold('SUMMARY:' + summary));
        lines.push(fold('DESCRIPTION:Category: ' + bill.category + ' | Amount: ' + formatMoney(bill.amount)));
        lines.push('CATEGORIES:' + bill.category.toUpperCase());
        lines.push('BEGIN:VALARM');
        lines.push('ACTION:DISPLAY');
        lines.push(fold('DESCRIPTION:Reminder: ' + summary));
        lines.push('TRIGGER:-P' + ALARM_DAYS + 'D');
        lines.push('END:VALARM');
        lines.push('END:VEVENT');
      });
    }

    lines.push('END:VCALENDAR');
    return lines.join(CRLF) + CRLF;
  }

  function downloadBlob(content, filename, mimeType) {
    var blob  = new Blob([content], { type: mimeType });
    var url   = URL.createObjectURL(blob);
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

    if (isIOS) {
      // `a.download` on iOS saves to Files and bypasses MIME-type handling,
      // so Calendar never gets the file. Navigating directly lets Safari
      // detect text/calendar and hand it off to the Calendar app.
      window.location.href = url;
    } else {
      var a    = document.createElement('a');
      a.href     = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }

  // ─── TAB NAVIGATION ───────────────────────────────────────────────────────
  function switchTab(tabName) {
    activeTab = tabName;

    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-panel').forEach(function (panel) {
      panel.classList.toggle('active', panel.id === 'tab-' + tabName);
    });

    if (tabName === 'bills')    renderBillsTable();
    if (tabName === 'tracker')  renderTracker();
    if (tabName === 'analysis') renderAnalysis();
  }

  // ─── EVENT WIRING ─────────────────────────────────────────────────────────
  function wireEvents() {
    // Tab nav
    document.getElementById('tabNav').addEventListener('click', function (e) {
      var btn = e.target.closest('.tab-btn');
      if (btn) switchTab(btn.dataset.tab);
    });

    // Bills tab: add button
    document.getElementById('addBillBtn').addEventListener('click', function () {
      openBillModal(null);
    });

    // Bills table: edit / delete delegation
    document.getElementById('billsTableBody').addEventListener('click', function (e) {
      var edit = e.target.closest('.edit-bill-btn');
      var del  = e.target.closest('.delete-bill-btn');
      if (edit) openBillModal(edit.dataset.id);
      if (del)  deleteBill(del.dataset.id);
    });

    // Bill modal: form submit
    document.getElementById('billForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var name    = document.getElementById('billName').value.trim();
      var amount  = parseFloat(document.getElementById('billAmount').value);
      var dueDay  = parseInt(document.getElementById('billDueDay').value, 10);
      var category = document.getElementById('billCategory').value;
      var active  = document.getElementById('billActive').checked;

      if (!name || isNaN(amount) || amount <= 0 || isNaN(dueDay) || dueDay < 1 || dueDay > 28) {
        alert('Please fill in all fields correctly. Due day must be between 1 and 28.');
        return;
      }

      var editId = document.getElementById('billEditId').value;
      var data   = { name: name, amount: amount, dueDay: dueDay, category: category, active: active };
      if (editId) updateBill(editId, data); else addBill(data);
      closeBillModal();
    });

    document.getElementById('cancelBillBtn').addEventListener('click', closeBillModal);
    document.getElementById('billModal').addEventListener('click', function (e) {
      if (e.target === document.getElementById('billModal')) closeBillModal();
    });

    // Tracker: month navigation
    document.getElementById('prevMonthBtn').addEventListener('click', function () {
      trackerMonth--;
      if (trackerMonth < 0) { trackerMonth = 11; trackerYear--; }
      renderTracker();
    });
    document.getElementById('nextMonthBtn').addEventListener('click', function () {
      trackerMonth++;
      if (trackerMonth > 11) { trackerMonth = 0; trackerYear++; }
      renderTracker();
    });

    // Tracker table: mark paid / undo delegation
    document.getElementById('trackerTableBody').addEventListener('click', function (e) {
      var payBtn   = e.target.closest('.pay-btn');
      var unpayBtn = e.target.closest('.unpay-btn');
      if (payBtn)   openPayModal(payBtn.dataset.billId, payBtn.dataset.month);
      if (unpayBtn) unmarkPaid(unpayBtn.dataset.billId, unpayBtn.dataset.month);
    });

    // Pay modal: form submit
    document.getElementById('payForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var billId   = document.getElementById('payBillId').value;
      var month    = document.getElementById('payMonth').value;
      var paidDate = document.getElementById('payDate').value;
      var amount   = parseFloat(document.getElementById('payAmount').value);

      if (!paidDate || isNaN(amount) || amount <= 0) {
        alert('Please enter a valid date and amount.');
        return;
      }

      markPaid(billId, month, paidDate, amount);
      closePayModal();
    });

    document.getElementById('cancelPayBtn').addEventListener('click', closePayModal);
    document.getElementById('payModal').addEventListener('click', function (e) {
      if (e.target === document.getElementById('payModal')) closePayModal();
    });

    // ICS export
    document.getElementById('exportIcsBtn').addEventListener('click', function () {
      var active = bills.filter(function (b) { return b.active; });
      if (active.length === 0) {
        alert('No active bills to export. Add some bills first.');
        return;
      }
      downloadBlob(generateICS(), 'bills.ics', 'text/calendar;charset=utf-8');
    });

    // Close modals on Escape key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeBillModal();
        closePayModal();
      }
    });
  }

  // ─── INIT ─────────────────────────────────────────────────────────────────
  function init() {
    loadData();
    var now      = new Date();
    trackerYear  = now.getFullYear();
    trackerMonth = now.getMonth();
    wireEvents();
    renderBillsTable();
  }

  init();
}());
