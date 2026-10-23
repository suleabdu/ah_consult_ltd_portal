/* =============================================================================
   js/admin.js
   AH Student Hub — Admin Dashboard logic. Ported from AdminDashboard.html's
   inline <script>. google.script.run calls become Api.call() against
   Flask's /api/admin/* endpoints. EXTENDED with Tutors, Intake Modes, and
   per-course tutor assignment — see admin-dashboard's header note.
   ============================================================================= */

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'tutors', label: 'Tutors', icon: '🎓' },
  { id: 'intakes', label: 'Intake Modes', icon: '🗓️' },
  { id: 'diagnostics', label: 'Diagnostics', icon: '🩺' },
];

let sessionToken = null;
let allRows = [];
let admissionStatuses = [];
let allTutors = [];

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById('view-' + id).classList.remove('hidden');
}

function handleNavClick(navId) {
  showView(navId);
  if (navId === 'tutors') loadTutors();
  if (navId === 'intakes') loadIntakes();
}

function doLogout() {
  Api.call('/api/auth/logout', {}, function () { }, function () { }, sessionToken);
  sessionStorage.removeItem('ahSessionToken');
  sessionStorage.removeItem('ahRole');
  sessionStorage.removeItem('ahDisplayName');
  window.location.href = 'staff-login';
}

function showNotLoggedIn() {
  document.getElementById('loadingSpinnerState').classList.add('hidden');
  document.getElementById('loadingErrorState').classList.add('hidden');
  document.getElementById('notLoggedInState').classList.remove('hidden');
}

function renderSummaryCards(summary) {
  const items = [
    { label: 'Total Applications', value: summary.totalApplications, icon: '📋' },
    { label: 'Admitted', value: summary.admitted, icon: '✅' },
    { label: 'Pending', value: summary.pending, icon: '⏳' },
    { label: 'Rejected', value: summary.rejected, icon: '❌' },
  ];
  document.getElementById('summaryCardsGrid').innerHTML = items.map(item => `
        <div class="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <div class="text-2xl mb-2">${item.icon}</div>
          <p class="text-xs uppercase tracking-wide text-gray-500 font-bold mb-1">${item.label}</p>
          <p class="text-2xl font-black text-gray-900">${item.value}</p>
        </div>
      `).join('');
}

function populateFilterOptions(rows) {
  const courseSet = new Set();
  const categorySet = new Set();
  rows.forEach(r => (r.courses || []).forEach(c => {
    if (c.course) courseSet.add(c.course);
    if (c.category) categorySet.add(c.category);
  }));

  const courseSelect = document.getElementById('filterCourse');
  Array.from(courseSet).sort().forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    courseSelect.appendChild(opt);
  });

  const categorySelect = document.getElementById('filterCategory');
  Array.from(categorySet).sort().forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    categorySelect.appendChild(opt);
  });

  const statusSelect = document.getElementById('filterStatus');
  admissionStatuses.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = s;
    statusSelect.appendChild(opt);
  });
}

function matchesFilters(row) {
  const search = document.getElementById('filterSearch').value.trim().toLowerCase();
  const course = document.getElementById('filterCourse').value;
  const category = document.getElementById('filterCategory').value;
  const status = document.getElementById('filterStatus').value;

  if (search) {
    const haystack = `${row.fullName} ${row.regId} ${row.email}`.toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  if (course && !(row.courses || []).some(c => c.course === course)) return false;
  if (category && !(row.courses || []).some(c => c.category === category)) return false;
  if (status && row.admissionStatus !== status) return false;
  return true;
}

function statusBadgeClass(status) {
  if (status === 'Admitted') return 'bg-green-100 text-green-700';
  if (status === 'Rejected') return 'bg-red-100 text-red-700';
  return 'bg-orange-100 text-orange-700';
}

function renderTable() {
  const tbody = document.getElementById('adminTableBody');
  const emptyMsg = document.getElementById('adminTableEmpty');
  const visible = allRows.filter(matchesFilters);

  if (visible.length === 0) {
    tbody.innerHTML = '';
    emptyMsg.classList.remove('hidden');
    return;
  }
  emptyMsg.classList.add('hidden');

  tbody.innerHTML = visible.map((row, i) => {
    const coursesDetail = (row.courses || []).length === 0
      ? '<span class="text-gray-400">No courses recorded</span>'
      : row.courses.map((c, ci) => {
        const tutorOptions = allTutors
          .filter(t => t.Course === c.course && t.Category === c.category)
          .map(t => `<option value="${t.Email}" ${t.Email === c.assignedTutor ? 'selected' : ''}>${t.TutorName || t.Email}</option>`)
          .join('');
        const noMatchingTutors = tutorOptions === '';
        return `
            <div class="flex flex-wrap items-center gap-3 py-2 ${ci > 0 ? 'border-t border-gray-200' : ''}">
              <span class="min-w-[220px]">${c.course} <span class="text-gray-400">(${c.category})</span> — ₦${(Number(c.fee) || 0).toLocaleString()}</span>
              <label class="text-gray-400 text-xs uppercase tracking-wide">Tutor:</label>
              <select class="tutor-assign-select input-light text-xs p-1.5 rounded-lg" data-reg-id="${row.regId}" data-course="${c.course}" ${noMatchingTutors ? 'disabled' : ''}>
                <option value="">— Unassigned —</option>
                ${tutorOptions}
              </select>
              ${noMatchingTutors ? '<span class="text-xs text-gray-400 italic">No tutor registered for this course/category yet</span>' : ''}
            </div>`;
      }).join('');

    return `
          <tr class="border-t border-gray-100 hover:bg-gray-50 align-top">
            <td class="px-4 py-3">
              <button type="button" class="expand-toggle text-gray-400 hover:text-gray-700 font-bold" data-row="${i}" title="Show enrolled courses">&#9656;</button>
            </td>
            <td class="px-4 py-3 font-bold text-gray-800">${row.fullName || ''}</td>
            <td class="px-4 py-3 font-mono text-orange-600">${row.regId || ''}</td>
            <td class="px-4 py-3">${row.dob || ''}</td>
            <td class="px-4 py-3">${row.gender || ''}</td>
            <td class="px-4 py-3">${row.email || ''}</td>
            <td class="px-4 py-3">${row.intakeMode || ''}</td>
            <td class="px-4 py-3 text-center">${row.totalCourseRegistered || 0}</td>
            <td class="px-4 py-3 font-bold">₦${(Number(row.courseFee) || 0).toLocaleString()}</td>
            <td class="px-4 py-3">${row.learningMode || ''}</td>
            <td class="px-4 py-3">${row.paymentStatus || ''}</td>
            <td class="px-4 py-3">
              <select data-reg-id="${row.regId}" class="admission-select text-xs font-bold uppercase tracking-wide px-2 py-1.5 rounded-full border-0 ${statusBadgeClass(row.admissionStatus)}">
                ${admissionStatuses.map(s => `<option value="${s}" ${s === row.admissionStatus ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </td>
          </tr>
          <tr class="course-detail-row hidden border-t border-gray-50 bg-gray-50" data-detail-for="${i}">
            <td></td>
            <td colspan="11" class="px-4 py-3 text-xs text-gray-600">${coursesDetail}</td>
          </tr>
        `;
  }).join('');

  tbody.querySelectorAll('.expand-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const detailRow = tbody.querySelector(`.course-detail-row[data-detail-for="${btn.dataset.row}"]`);
      detailRow.classList.toggle('hidden');
      btn.innerHTML = detailRow.classList.contains('hidden') ? '&#9656;' : '&#9662;';
    });
  });

  tbody.querySelectorAll('.admission-select').forEach(sel => {
    sel.addEventListener('change', () => onAdmissionStatusChange(sel));
  });

  tbody.querySelectorAll('.tutor-assign-select').forEach(sel => {
    sel.addEventListener('change', () => onTutorAssignChange(sel));
  });
}

function onTutorAssignChange(selectEl) {
  const regId = selectEl.dataset.regId;
  const course = selectEl.dataset.course;
  const tutorEmail = selectEl.value;
  selectEl.disabled = true;

  Api.call('/api/admin/registrations/assign-tutor', { regId, course, tutorEmail }, function () {
    selectEl.disabled = false;
    const row = allRows.find(r => r.regId === regId);
    const courseEntry = row && (row.courses || []).find(c => c.course === course);
    if (courseEntry) courseEntry.assignedTutor = tutorEmail;
  }, function (err) {
    selectEl.disabled = false;
    alert('Something went wrong: ' + (err.message || err));
    renderTable(); // revert the dropdown to the last known-good state
  }, sessionToken);
}

function onAdmissionStatusChange(selectEl) {
  const regId = selectEl.dataset.regId;
  const newStatus = selectEl.value;
  selectEl.disabled = true;

  Api.call('/api/admin/registrations/update-status', { regId, newStatus }, function () {
    selectEl.disabled = false;
    const row = allRows.find(r => r.regId === regId);
    if (row) row.admissionStatus = newStatus;
    selectEl.className = 'admission-select text-xs font-bold uppercase tracking-wide px-2 py-1.5 rounded-full border-0 ' + statusBadgeClass(newStatus);
    refreshSummaryFromRows();
  }, function (err) {
    selectEl.disabled = false;
    alert('Something went wrong: ' + (err.message || err));
  }, sessionToken);
}

function refreshSummaryFromRows() {
  const summary = { totalApplications: allRows.length, admitted: 0, pending: 0, rejected: 0 };
  allRows.forEach(r => {
    if (r.admissionStatus === 'Admitted') summary.admitted++;
    else if (r.admissionStatus === 'Rejected') summary.rejected++;
    else summary.pending++;
  });
  renderSummaryCards(summary);
}

['filterSearch', 'filterCourse', 'filterCategory', 'filterStatus'].forEach(id => {
  document.addEventListener('DOMContentLoaded', function () {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('input', renderTable); el.addEventListener('change', renderTable); }
  });
});

// ============================ TUTORS ============================

function loadTutors() {
  Api.call('/api/admin/tutors', {}, function (res) {
    allTutors = res.tutors || [];
    renderTutorsTable(allTutors);
  }, function () { }, sessionToken);
}

function renderTutorsTable(tutors) {
  const tbody = document.getElementById('tutorsTableBody');
  if (!tutors || tutors.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-6 text-center text-gray-400">No tutors added yet.</td></tr>';
    return;
  }
  tbody.innerHTML = tutors.map(t => `
        <tr class="border-t border-gray-100">
          <td class="px-4 py-3 font-bold text-gray-800">${t.TutorName || '(not set yet)'}</td>
          <td class="px-4 py-3 font-mono text-orange-600">${t.Email || ''}</td>
          <td class="px-4 py-3">${t.Course || ''}</td>
          <td class="px-4 py-3">${t.Category || ''}</td>
          <td class="px-4 py-3 font-mono">${t.TutorCode || ''}</td>
        </tr>
      `).join('');
}

function addTutorClick() {
  const errEl = document.getElementById('addTutorError');
  errEl.classList.add('hidden');

  const email = document.getElementById('newTutorEmail').value.trim();
  const course = document.getElementById('newTutorCourse').value;
  const category = document.getElementById('newTutorCategory').value;
  if (!email || !course || !category) {
    errEl.innerText = 'Email, course, and category are all required.';
    errEl.classList.remove('hidden');
    return;
  }

  const btn = document.getElementById('addTutorBtn');
  btn.disabled = true;
  Api.call('/api/admin/tutors/create', {
    name: document.getElementById('newTutorName').value.trim(),
    email: email, course: course, category: category,
  }, function () {
    btn.disabled = false;
    document.getElementById('newTutorName').value = '';
    document.getElementById('newTutorEmail').value = '';
    document.getElementById('newTutorCourse').value = '';
    document.getElementById('newTutorCategory').value = '';
    loadTutors();
  }, function (err) {
    btn.disabled = false;
    errEl.innerText = (err && err.message) || 'Something went wrong.';
    errEl.classList.remove('hidden');
  }, sessionToken);
}

// ============================ INTAKE MODES ============================

function loadIntakes() {
  Api.call('/api/admin/intakes', {}, function (res) { renderIntakesList(res.intakes); }, function () { }, sessionToken);
}

function toDateInputValue_(isoLike) {
  if (!isoLike) return '';
  return String(isoLike).split('T')[0];
}

function renderIntakesList(intakes) {
  const listEl = document.getElementById('intakesList');
  if (!intakes || intakes.length === 0) {
    listEl.innerHTML = '<p class="text-sm text-gray-500 italic">No intakes configured yet — add one above.</p>';
    return;
  }

  listEl.innerHTML = intakes.map((intake, i) => `
        <div class="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <span class="font-bold text-gray-800">${intake.label}</span>
              <span class="text-xs font-bold uppercase tracking-wide px-3 py-1 rounded-full ${intake.isOpen ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}">${intake.isOpen ? 'Open' : 'Closed'}</span>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <label class="text-xs text-gray-500">Opens</label>
              <input type="date" id="intakeOpen-${i}" value="${toDateInputValue_(intake.openingDate)}" class="input-light text-xs p-1.5 rounded-lg">
              <label class="text-xs text-gray-500">Closes</label>
              <input type="date" id="intakeClose-${i}" value="${toDateInputValue_(intake.closingDate)}" class="input-light text-xs p-1.5 rounded-lg">
              <button type="button" onclick="saveIntakeClick('${intake.label.replace(/'/g, "\\'")}', ${i})" class="theme-bg-accent hover:bg-orange-600 text-white font-bold py-1.5 px-4 rounded-lg text-xs uppercase tracking-wide">Save</button>
            </div>
          </div>
          <p id="intakeError-${i}" class="hidden text-red-600 text-sm mt-2"></p>
        </div>
      `).join('');
}

function saveIntakeClick(label, i) {
  const errEl = document.getElementById('intakeError-' + i);
  errEl.classList.add('hidden');
  const openingDate = document.getElementById('intakeOpen-' + i).value;
  const closingDate = document.getElementById('intakeClose-' + i).value;

  Api.call('/api/admin/intakes/update', { label, openingDate, closingDate }, function () {
    loadIntakes();
  }, function (err) {
    errEl.innerText = (err && err.message) || 'Something went wrong.';
    errEl.classList.remove('hidden');
  }, sessionToken);
}

function addIntakeClick() {
  const errEl = document.getElementById('addIntakeError');
  errEl.classList.add('hidden');

  const label = document.getElementById('newIntakeLabel').value.trim();
  const openingDate = document.getElementById('newIntakeOpen').value;
  const closingDate = document.getElementById('newIntakeClose').value;
  if (!label) {
    errEl.innerText = 'Please name this intake, e.g. "June 2027 Intake".';
    errEl.classList.remove('hidden');
    return;
  }
  if (!openingDate || !closingDate) {
    errEl.innerText = 'Please set both an opening and a closing date.';
    errEl.classList.remove('hidden');
    return;
  }

  const btn = document.getElementById('addIntakeBtn');
  btn.disabled = true;
  Api.call('/api/admin/intakes/update', { label, openingDate, closingDate }, function () {
    btn.disabled = false;
    document.getElementById('newIntakeLabel').value = '';
    document.getElementById('newIntakeOpen').value = '';
    document.getElementById('newIntakeClose').value = '';
    loadIntakes();
  }, function (err) {
    btn.disabled = false;
    errEl.innerText = (err && err.message) || 'Something went wrong.';
    errEl.classList.remove('hidden');
  }, sessionToken);
}

// ============================ DIAGNOSTICS ============================

function sendTestEmailClick() {
  const errEl = document.getElementById('testEmailError');
  const okEl = document.getElementById('testEmailSuccess');
  errEl.classList.add('hidden');
  okEl.classList.add('hidden');

  const to = document.getElementById('testEmailTo').value.trim();
  if (!to) {
    errEl.innerText = 'Please enter an email address.';
    errEl.classList.remove('hidden');
    return;
  }

  const btn = document.getElementById('testEmailBtn');
  btn.disabled = true;
  Api.call('/api/admin/email/test', { to }, function () {
    btn.disabled = false;
    okEl.innerText = 'Sent! Check ' + to + ' (and its spam folder).';
    okEl.classList.remove('hidden');
  }, function (err) {
    btn.disabled = false;
    errEl.innerText = (err && err.message) || 'Something went wrong.';
    errEl.classList.remove('hidden');
  }, sessionToken);
}

// ============================ LOAD ============================

let loadWatchdog = null;
let dashboardRetried = false;

function showLoadError(message) {
  clearTimeout(loadWatchdog);
  document.getElementById('loadingSpinnerState').classList.add('hidden');
  document.getElementById('loadingErrorMessage').innerText = message;
  document.getElementById('loadingErrorState').classList.remove('hidden');
}

function retryLoadDashboard() {
  dashboardRetried = false;
  document.getElementById('loadingErrorState').classList.add('hidden');
  document.getElementById('loadingSpinnerState').classList.remove('hidden');
  loadDashboard();
}

function loadDashboard() {
  clearTimeout(loadWatchdog);
  loadWatchdog = setTimeout(function () {
    showLoadError('The server didn\u2019t respond in time. Your connection may be slow, or the dashboard may be temporarily unavailable.');
  }, 15000);

  Api.call('/api/admin/dashboard', {}, function (res) {
    clearTimeout(loadWatchdog);
    try {
      document.getElementById('loadingScreen').classList.add('hidden');
      document.getElementById('dashboardRoot').classList.remove('hidden');

      allRows = res.rows || [];
      admissionStatuses = res.admissionStatuses || [];

      renderSidebar('app-sidebar', NAV_ITEMS, 'dashboard', handleNavClick, 'Admin Dashboard');
      renderHeader('app-header', 'Admin Dashboard', sessionStorage.getItem('ahDisplayName') || 'Admin', doLogout);
      renderFooter('app-footer');

      renderSummaryCards(res.summary || { totalApplications: 0, admitted: 0, pending: 0, rejected: 0 });
      populateFilterOptions(allRows);

      // Tutors are needed to populate the per-course "Assign Tutor"
      // dropdowns, so fetch them before the first render rather than
      // only when the Tutors tab is opened.
      Api.call('/api/admin/tutors', {}, function (tutorsRes) {
        allTutors = tutorsRes.tutors || [];
        renderTable();
      }, function () {
        renderTable(); // tutor list failed to load — table still renders, just without assignment options
      }, sessionToken);

      ['filterSearch', 'filterCourse', 'filterCategory', 'filterStatus'].forEach(id => {
        const el = document.getElementById(id);
        el.addEventListener('input', renderTable);
        el.addEventListener('change', renderTable);
      });
    } catch (renderErr) {
      showLoadError('Something went wrong displaying the dashboard. Please try again.');
    }
  }, function (err) {
    clearTimeout(loadWatchdog);
    if (!dashboardRetried) {
      dashboardRetried = true;
      setTimeout(loadDashboard, 900);
      return;
    }
    showLoadError((err && err.message) || 'Something went wrong loading the dashboard.');
  }, sessionToken);
}

(function init() {
  sessionToken = sessionStorage.getItem('ahSessionToken');
  const role = sessionStorage.getItem('ahRole');
  if (!sessionToken || role !== 'admin') {
    showNotLoggedIn();
    return;
  }
  loadDashboard();
})();
