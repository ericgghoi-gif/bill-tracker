(function () {
  'use strict';

  // ─── CONSTANTS ────────────────────────────────────────────────────────────
  const STORAGE_BILLS        = 'bt_bills';
  const STORAGE_PAYMENTS     = 'bt_payments';
  const STORAGE_NOTIF        = 'bt_notif';
  const STORAGE_NOTIF_SHOWN  = 'bt_notif_shown';
  const STORAGE_SNOOZE       = 'bt_snooze';
  const CATEGORIES           = ['Housing', 'Utilities', 'Subscriptions', 'Insurance', 'Loans', 'Other'];

  // ─── STATE ────────────────────────────────────────────────────────────────
  let bills         = [];
  let payments      = [];
  let notifSettings = { enabled: false, daysBefore: 3 };
  let activeTab     = 'bills';
  let trackerYear   = 0;
  let trackerMonth  = 0;

  // ─── STORAGE ──────────────────────────────────────────────────────────────
  function loadData() {
    try {
      bills    = JSON.parse(localStorage.getItem(STORAGE_BILLS)    || '[]');
      payments = JSON.parse(localStorage.getItem(STORAGE_PAYMENTS) || '[]');
      var ns   = JSON.parse(localStorage.getItem(STORAGE_NOTIF)    || 'null');
      if (ns) notifSettings = ns;
    } catch (e) {
      bills    = [];
      payments = [];
    }
  }

  function saveBills()    { localStorage.setItem(STORAGE_BILLS,    JSON.stringify(bills));    }
  function savePayments() { localStorage.setItem(STORAGE_PAYMENTS, JSON.stringify(payments)); }
  function saveNotif()    { localStorage.setItem(STORAGE_NOTIF,    JSON.stringify(notifSettings)); }

  // ─── SNOOZE ───────────────────────────────────────────────────────────────
  function getSnoozes() {
    try { return JSON.parse(localStorage.getItem(STORAGE_SNOOZE) || '{}'); } catch(e) { return {}; }
  }

  function snoozeUntil(billId, monthKey, days) {
    var snoozes = getSnoozes();
    snoozes[billId + '-' + monthKey] = Date.now() + days * 86400000;
    localStorage.setItem(STORAGE_SNOOZE, JSON.stringify(snoozes));
    renderTracker();
  }

  function clearSnooze(billId, monthKey) {
    var snoozes = getSnoozes();
    delete snoozes[billId + '-' + monthKey];
    localStorage.setItem(STORAGE_SNOOZE, JSON.stringify(snoozes));
    renderTracker();
  }

  function isSnoozed(billId, monthKey) {
    var snoozes = getSnoozes();
    var key = billId + '-' + monthKey;
    if (!snoozes[key]) return false;
    if (Date.now() > snoozes[key]) {
      delete snoozes[key];
      localStorage.setItem(STORAGE_SNOOZE, JSON.stringify(snoozes));
      return false;
    }
    return true;
  }

  function snoozeDate(billId, monthKey) {
    var ts = getSnoozes()[billId + '-' + monthKey];
    return ts ? new Date(ts) : null;
  }

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

  function updatePayment(billId, month, paidDate, amount) {
    var idx = payments.findIndex(function (p) { return p.billId === billId && p.month === month; });
    if (idx < 0) return;
    payments[idx] = Object.assign({}, payments[idx], { paidDate: paidDate, amount: Number(amount) });
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

    var tbody    = document.getElementById('trackerTableBody');
    var emptyMsg = document.getElementById('trackerEmpty');
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

      var snoozed = !isPaid && isSnoozed(bill.id, monthKey);
      var sd      = snoozed ? snoozeDate(bill.id, monthKey) : null;

      var tr = document.createElement('tr');
      if (isPaid)   tr.classList.add('row--paid');
      if (snoozed)  tr.classList.add('row--snoozed');

      var paidOnCell = isPaid
        ? '<span class="paid-date">' + formatDateStr(payment.paidDate) + '</span>'
        : snoozed
          ? '<span class="snooze-label">Until ' + sd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '</span>'
          : '<span class="txt--muted">—</span>';

      var actionCell = isPaid
        ? '<button class="btn btn--sm btn--ghost edit-pay-btn" data-bill-id="' + bill.id + '" data-month="' + monthKey + '">Edit</button>'
        : snoozed
          ? '<button class="btn btn--sm btn--ghost clear-snooze-btn" data-bill-id="' + bill.id + '" data-month="' + monthKey + '">Clear</button>'
          : '<select class="snooze-select" data-bill-id="' + bill.id + '" data-month="' + monthKey + '">' +
              '<option value="">Snooze...</option>' +
              '<option value="1">1 day</option>' +
              '<option value="3">3 days</option>' +
              '<option value="7">7 days</option>' +
            '</select>';

      tr.innerHTML =
        '<td class="check-cell">' +
          '<input type="checkbox" class="pay-check"' +
          ' data-bill-id="' + bill.id + '"' +
          ' data-month="' + monthKey + '"' +
          ' data-amount="' + bill.amount + '"' +
          (isPaid ? ' checked' : '') + '>' +
        '</td>' +
        '<td>' + escHtml(bill.name) + '</td>' +
        '<td><span class="badge badge--' + bill.category.toLowerCase() + '">' + bill.category + '</span></td>' +
        '<td>' + formatDateStr(dueDateStr) + '</td>' +
        '<td>' + formatMoney(bill.amount) + '</td>' +
        '<td class="paid-on-cell">' + paidOnCell + '</td>' +
        '<td class="action-cell">' + actionCell + '</td>';
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
      var val   = totals[key];
      var pct   = Math.round((val / maxVal) * 100);
      var info  = parseMonthKey(key);
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
      var diff      = Math.round((item.dueDate - today) / 86400000);
      var when      = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : 'In ' + diff + ' days';
      var dateLabel = item.dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      var urgent    = diff <= 3 ? 'due-item--urgent' : '';
      var mKey      = toMonthKey(item.dueDate);
      var isPaid    = !!getPayment(item.bill.id, mKey);

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
  function openPayModal(billId, month, editMode) {
    document.getElementById('payBillId').value   = billId;
    document.getElementById('payMonth').value    = month;
    document.getElementById('payEditMode').value = editMode ? 'edit' : '';
    document.getElementById('payModalTitle').textContent = editMode ? 'Edit Payment' : 'Mark as Paid';

    if (editMode) {
      var existing = getPayment(billId, month);
      if (existing) {
        document.getElementById('payDate').value   = existing.paidDate;
        document.getElementById('payAmount').value = existing.amount;
      }
    } else {
      document.getElementById('payDate').value = new Date().toISOString().slice(0, 10);
      var bill = bills.find(function (b) { return b.id === billId; });
      if (bill) document.getElementById('payAmount').value = bill.amount;
    }

    document.getElementById('payModal').hidden = false;
    document.getElementById('payDate').focus();
  }

  function closePayModal() {
    document.getElementById('payModal').hidden = true;
  }

  // ─── NOTIFICATIONS ────────────────────────────────────────────────────────
  function notifSupported() {
    return 'Notification' in window;
  }

  function updateNotifUI() {
    var btn    = document.getElementById('notifBtn');
    var bar    = document.getElementById('notifBar');
    var select = document.getElementById('notifDaysSelect');

    // Always show the button — even on iOS Safari where Notification isn't
    // available yet (user needs to add to Home Screen first).
    btn.hidden = false;

    if (!notifSupported()) {
      btn.textContent = '🔔 Enable Reminders';
      btn.classList.add('btn--ghost');
      btn.classList.remove('btn--success');
      bar.hidden = true;
      return;
    }

    select.value = String(notifSettings.daysBefore);

    if (notifSettings.enabled && Notification.permission === 'granted') {
      var d = notifSettings.daysBefore;
      btn.textContent = '🔔 ' + d + ' day' + (d > 1 ? 's' : '') + ' before';
      btn.classList.remove('btn--ghost');
      btn.classList.add('btn--success');
      bar.hidden = false;
    } else {
      btn.textContent = '🔔 Enable Reminders';
      btn.classList.add('btn--ghost');
      btn.classList.remove('btn--success');
      bar.hidden = true;
    }
  }

  function enableNotifications() {
    if (!notifSupported()) {
      alert('To enable reminders on iPhone:\n\n1. Tap the Share button (box with arrow) in Safari\n2. Tap "Add to Home Screen"\n3. Open the app from your Home Screen\n4. Tap "Enable Reminders" again\n\nReminders require iOS 16.4 or later.');
      return;
    }

    if (Notification.permission === 'granted') {
      notifSettings.enabled = true;
      saveNotif();
      updateNotifUI();
      checkAndNotify();
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(function (permission) {
        if (permission === 'granted') {
          notifSettings.enabled = true;
          saveNotif();
          updateNotifUI();
          checkAndNotify();
        } else {
          alert('Notification permission was not granted. You can enable it later in your browser settings.');
        }
      });
    } else {
      alert('Notifications are blocked for this site. Please enable them in your browser or system settings, then try again.');
    }
  }

  function disableNotifications() {
    notifSettings.enabled = false;
    saveNotif();
    updateNotifUI();
  }

  function checkAndNotify() {
    if (!notifSettings.enabled || !notifSupported() || Notification.permission !== 'granted') return;

    var today    = new Date(); today.setHours(0, 0, 0, 0);
    var todayStr = today.toISOString().slice(0, 10);
    var shown    = {};
    try { shown = JSON.parse(localStorage.getItem(STORAGE_NOTIF_SHOWN) || '{}'); } catch (e) {}

    bills.filter(function (b) { return b.active; }).forEach(function (bill) {
      // Check current and next month to catch bills crossing the month boundary
      [0, 1].forEach(function (offset) {
        var dueDate = new Date(today.getFullYear(), today.getMonth() + offset, bill.dueDay);
        var diff    = Math.round((dueDate - today) / 86400000);

        if (diff < 0 || diff > notifSettings.daysBefore) return;

        var monthKey = toMonthKey(dueDate);
        if (getPayment(bill.id, monthKey)) return;   // already paid this month
        if (isSnoozed(bill.id, monthKey)) return;    // snoozed by user

        var notifKey = bill.id + '-' + monthKey;
        if (shown[notifKey] === todayStr) return;     // already notified today

        var title = diff === 0
          ? bill.name + ' is due today!'
          : bill.name + ' due in ' + diff + ' day' + (diff > 1 ? 's' : '');

        try {
          new Notification(title, {
            body: 'Amount: ' + formatMoney(bill.amount) + ' · ' + bill.category,
            tag:  notifKey,
            icon: 'icon.svg',
          });
          shown[notifKey] = todayStr;
        } catch (e) {}
      });
    });

    localStorage.setItem(STORAGE_NOTIF_SHOWN, JSON.stringify(shown));
  }

  // ─── DATA BACKUP / RESTORE ────────────────────────────────────────────────
  function exportData() {
    var data = { bills: bills, payments: payments, exported: new Date().toISOString() };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = 'bill-tracker-backup.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importData(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);
        if (!Array.isArray(data.bills)) throw new Error('Invalid format');
        if (!confirm('Replace all current data with this backup? This cannot be undone.')) return;
        bills    = data.bills;
        payments = Array.isArray(data.payments) ? data.payments : [];
        saveBills();
        savePayments();
        renderBillsTable();
        if (activeTab === 'tracker')  renderTracker();
        if (activeTab === 'analysis') renderAnalysis();
        alert('Backup restored successfully.');
      } catch (err) {
        alert('Failed to restore: invalid backup file.');
      }
    };
    reader.readAsText(file);
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

  // ─── SERVICE WORKER ───────────────────────────────────────────────────────
  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(function (e) {
        console.warn('SW registration failed:', e);
      });
    }
  }

  // ─── EVENT WIRING ─────────────────────────────────────────────────────────
  function wireEvents() {
    document.getElementById('tabNav').addEventListener('click', function (e) {
      var btn = e.target.closest('.tab-btn');
      if (btn) switchTab(btn.dataset.tab);
    });

    document.getElementById('addBillBtn').addEventListener('click', function () {
      openBillModal(null);
    });

    document.getElementById('billsTableBody').addEventListener('click', function (e) {
      var edit = e.target.closest('.edit-bill-btn');
      var del  = e.target.closest('.delete-bill-btn');
      if (edit) openBillModal(edit.dataset.id);
      if (del)  deleteBill(del.dataset.id);
    });

    document.getElementById('billForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var name     = document.getElementById('billName').value.trim();
      var amount   = parseFloat(document.getElementById('billAmount').value);
      var dueDay   = parseInt(document.getElementById('billDueDay').value, 10);
      var category = document.getElementById('billCategory').value;
      var active   = document.getElementById('billActive').checked;

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

    document.getElementById('trackerTableBody').addEventListener('change', function (e) {
      var check  = e.target.closest('.pay-check');
      var snooze = e.target.closest('.snooze-select');

      if (check) {
        if (check.checked) {
          var today = new Date().toISOString().slice(0, 10);
          markPaid(check.dataset.billId, check.dataset.month, today, parseFloat(check.dataset.amount));
        } else {
          unmarkPaid(check.dataset.billId, check.dataset.month);
        }
      }

      if (snooze && snooze.value) {
        snoozeUntil(snooze.dataset.billId, snooze.dataset.month, parseInt(snooze.value, 10));
      }
    });

    document.getElementById('trackerTableBody').addEventListener('click', function (e) {
      var editBtn  = e.target.closest('.edit-pay-btn');
      var clearBtn = e.target.closest('.clear-snooze-btn');
      if (editBtn)  openPayModal(editBtn.dataset.billId, editBtn.dataset.month, true);
      if (clearBtn) clearSnooze(clearBtn.dataset.billId, clearBtn.dataset.month);
    });

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

      var editMode = document.getElementById('payEditMode').value;
      if (editMode === 'edit') {
        updatePayment(billId, month, paidDate, amount);
      } else {
        markPaid(billId, month, paidDate, amount);
      }
      closePayModal();
    });

    document.getElementById('cancelPayBtn').addEventListener('click', closePayModal);
    document.getElementById('payModal').addEventListener('click', function (e) {
      if (e.target === document.getElementById('payModal')) closePayModal();
    });

    // Notification controls
    document.getElementById('notifBtn').addEventListener('click', function () {
      if (notifSettings.enabled && Notification.permission === 'granted') {
        var bar = document.getElementById('notifBar');
        bar.hidden = !bar.hidden;
      } else {
        enableNotifications();
      }
    });

    document.getElementById('notifDaysSelect').addEventListener('change', function () {
      notifSettings.daysBefore = parseInt(this.value, 10);
      saveNotif();
      updateNotifUI();
    });

    document.getElementById('notifDisableBtn').addEventListener('click', disableNotifications);

    // Data backup / restore
    document.getElementById('exportDataBtn').addEventListener('click', exportData);
    document.getElementById('importDataInput').addEventListener('change', function (e) {
      if (e.target.files[0]) {
        importData(e.target.files[0]);
        e.target.value = '';
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeBillModal();
        closePayModal();
      }
    });
  }

  // ─── PULL-TO-REFRESH ──────────────────────────────────────────────────────
  function initPullToRefresh() {
    var startY    = 0;
    var threshold = 80;   // px of pull needed to trigger
    var indicator = document.getElementById('pullIndicator');

    document.addEventListener('touchstart', function (e) {
      if (window.scrollY === 0) startY = e.touches[0].clientY;
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
      if (!startY) return;
      var pullDistance = e.touches[0].clientY - startY;
      if (pullDistance > 0 && window.scrollY === 0) {
        var progress = Math.min(pullDistance / threshold, 1);
        indicator.style.opacity  = String(progress);
        indicator.style.transform = 'translateY(' + Math.min(pullDistance * 0.4, 36) + 'px)';
      }
    }, { passive: true });

    document.addEventListener('touchend', function (e) {
      if (!startY) return;
      var pullDistance = e.changedTouches[0].clientY - startY;
      indicator.style.opacity   = '0';
      indicator.style.transform = 'translateY(0)';
      startY = 0;
      if (pullDistance >= threshold && window.scrollY === 0) {
        location.reload();
      }
    }, { passive: true });
  }

  // ─── INIT ─────────────────────────────────────────────────────────────────
  function init() {
    loadData();

    var now      = new Date();
    trackerYear  = now.getFullYear();
    trackerMonth = now.getMonth();

    wireEvents();
    registerSW();
    updateNotifUI();
    initPullToRefresh();

    // Ask the browser to treat this site's storage as durable (won't be auto-cleared)
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist();
    }

    renderBillsTable();

    // Fire any pending notifications after a short delay so the page finishes loading
    if (notifSettings.enabled) {
      setTimeout(checkAndNotify, 800);
    }
  }

  init();
}());
