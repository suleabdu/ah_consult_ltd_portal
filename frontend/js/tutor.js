/* =============================================================================
   js/tutor.js
   AH Student Hub — Tutor Portal logic. Ported from Tutor.html's inline
   <script>, google.script.run calls become Api.call() against Flask's
   /api/tutor/* endpoints. EXTENDED with real Set-Up-Exams, Start-New-
   Lecture, and Grade-Student handlers — see tutor's header note.
   ============================================================================= */

const NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: '🏠' },
  { id: 'assignments', label: 'Assignments', icon: '📝' },
  { id: 'submissions', label: 'Submissions', icon: '📥' },
  { id: 'exams', label: 'Set Up Exams', icon: '📚' },
  { id: 'lecture', label: 'Start New Lecture', icon: '🎥' },
  { id: 'results', label: 'Grade Student', icon: '🏆' },
];

let sessionToken = null;
let dashboardRetried = false;
let loadWatchdog = null;
let currentRoster = [];

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById('view-' + id).classList.remove('hidden');
}

function handleNavClick(navId) {
  showView(navId);
  if (navId === 'assignments') loadTutorAssignments();
  if (navId === 'submissions') loadSubmissions();
  if (navId === 'exams') loadExams();
  if (navId === 'lecture') loadLectures();
}

// ============================ ASSIGNMENTS (create / edit) ============================

function loadTutorAssignments() {
  Api.call('/api/tutor/assignments', {}, function (res) {
    renderAssignmentsManageList(res.assignments);
    populateSubmissionsFilter(res.assignments);
  }, function () { /* the page keeps whatever it last showed */ }, sessionToken);
}

function assignBadgeClass_(status) {
  return status === 'Closed' ? 'bg-gray-200 text-gray-600' : 'bg-green-100 text-green-700';
}

function renderAssignmentsManageList(assignments) {
  const listEl = document.getElementById('assignmentsManageList');
  const emptyEl = document.getElementById('assignmentsEmpty');
  if (!assignments || assignments.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  listEl.innerHTML = assignments.map(a => `
        <div class="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="font-bold text-gray-800">${a.title}</p>
              ${a.description ? `<p class="text-sm text-gray-500 mt-1">${a.description}</p>` : ''}
              <p class="text-xs text-gray-400 mt-1">${a.dueDate ? 'Due ' + a.dueDate : 'No due date'} ${a.maxScore ? '&middot; ' + a.maxScore + ' pts' : ''} &middot; ${a.submissionCount} submission${a.submissionCount === 1 ? '' : 's'} (${a.ungradedCount} ungraded)</p>
            </div>
            <span class="text-xs font-bold uppercase tracking-wide px-3 py-1 rounded-full whitespace-nowrap ${assignBadgeClass_(a.status)}">${a.status}</span>
          </div>
          <button type="button" onclick="toggleEditAssignment('${a.assignmentId}')" class="mt-3 text-sm theme-accent font-bold hover:underline">Edit</button>
          <div id="editForm-${a.assignmentId}" class="hidden mt-3 bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div id="editError-${a.assignmentId}" class="hidden bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-3"></div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <input type="text" id="editTitle-${a.assignmentId}" value="${(a.title || '').replace(/"/g, '&quot;')}" placeholder="Title" class="input-light p-3 rounded-lg w-full">
              <input type="date" id="editDueDate-${a.assignmentId}" value="${a.dueDate || ''}" class="input-light p-3 rounded-lg w-full">
              <input type="number" id="editMaxScore-${a.assignmentId}" value="${a.maxScore || ''}" placeholder="Max Score" min="0" class="input-light p-3 rounded-lg w-full">
              <select id="editStatus-${a.assignmentId}" class="input-light p-3 rounded-lg w-full">
                <option value="Active" ${a.status !== 'Closed' ? 'selected' : ''}>Active</option>
                <option value="Closed" ${a.status === 'Closed' ? 'selected' : ''}>Closed</option>
              </select>
            </div>
            <textarea id="editDescription-${a.assignmentId}" placeholder="Description" class="input-light p-3 rounded-lg w-full mb-3" rows="3">${a.description || ''}</textarea>
            <button type="button" onclick="saveEditAssignment('${a.assignmentId}')" class="theme-bg-accent hover:bg-orange-600 text-white font-bold py-2 px-6 rounded-lg text-sm uppercase tracking-wide">Save Changes</button>
          </div>
        </div>
      `).join('');
}

function toggleEditAssignment(assignmentId) {
  document.getElementById('editForm-' + assignmentId).classList.toggle('hidden');
}

function createAssignmentClick() {
  const errEl = document.getElementById('createAssignError');
  errEl.classList.add('hidden');
  const title = document.getElementById('newAssignTitle').value.trim();
  if (!title) {
    errEl.innerText = 'Please enter a title.';
    errEl.classList.remove('hidden');
    return;
  }

  const btn = document.getElementById('createAssignBtn');
  btn.disabled = true;
  Api.call('/api/tutor/assignments/create', {
    title: title,
    description: document.getElementById('newAssignDescription').value,
    dueDate: document.getElementById('newAssignDueDate').value,
    maxScore: document.getElementById('newAssignMaxScore').value,
    attachmentUrl: document.getElementById('newAssignAttachment').value,
  }, function (res) {
    btn.disabled = false;
    document.getElementById('newAssignTitle').value = '';
    document.getElementById('newAssignDueDate').value = '';
    document.getElementById('newAssignMaxScore').value = '';
    document.getElementById('newAssignAttachment').value = '';
    document.getElementById('newAssignDescription').value = '';
    renderAssignmentsManageList(res.assignments);
    populateSubmissionsFilter(res.assignments);
  }, function (err) {
    btn.disabled = false;
    errEl.innerText = (err && err.message) || 'Something went wrong.';
    errEl.classList.remove('hidden');
  }, sessionToken);
}

function saveEditAssignment(assignmentId) {
  const errEl = document.getElementById('editError-' + assignmentId);
  errEl.classList.add('hidden');
  const title = document.getElementById('editTitle-' + assignmentId).value.trim();
  if (!title) {
    errEl.innerText = 'Please enter a title.';
    errEl.classList.remove('hidden');
    return;
  }

  Api.call('/api/tutor/assignments/update', {
    assignmentId: assignmentId,
    title: title,
    description: document.getElementById('editDescription-' + assignmentId).value,
    dueDate: document.getElementById('editDueDate-' + assignmentId).value,
    maxScore: document.getElementById('editMaxScore-' + assignmentId).value,
    status: document.getElementById('editStatus-' + assignmentId).value,
  }, function (res) {
    renderAssignmentsManageList(res.assignments);
    populateSubmissionsFilter(res.assignments);
  }, function (err) {
    errEl.innerText = (err && err.message) || 'Something went wrong.';
    errEl.classList.remove('hidden');
  }, sessionToken);
}

// ============================ SUBMISSIONS (review / grade) ============================

function populateSubmissionsFilter(assignments) {
  const select = document.getElementById('submissionsAssignmentFilter');
  const currentValue = select.value;
  select.innerHTML = '<option value="">All Assignments</option>' +
    assignments.map(a => `<option value="${a.assignmentId}">${a.title}</option>`).join('');
  select.value = currentValue;
}

function loadSubmissions() {
  const assignmentId = document.getElementById('submissionsAssignmentFilter').value;
  Api.call('/api/tutor/submissions', { assignmentId: assignmentId || null }, function (res) {
    renderSubmissionsList(res.submissions);
  }, function () { /* the page keeps whatever it last showed */ }, sessionToken);
}

function renderSubmissionsList(submissions) {
  const listEl = document.getElementById('submissionsList');
  const emptyEl = document.getElementById('submissionsEmpty');
  if (!submissions || submissions.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  listEl.innerHTML = submissions.map(s => `
        <div class="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="font-bold text-gray-800">${s.studentName}</p>
              <p class="text-sm text-gray-500">${s.assignmentTitle} &middot; Submitted ${s.submittedDate || ''}</p>
            </div>
            ${s.grade ? `<span class="text-xs font-bold uppercase tracking-wide px-3 py-1 rounded-full bg-blue-100 text-blue-700 whitespace-nowrap">Graded</span>` : `<span class="text-xs font-bold uppercase tracking-wide px-3 py-1 rounded-full bg-orange-100 text-orange-700 whitespace-nowrap">Ungraded</span>`}
          </div>
          ${s.submissionText ? `<p class="text-sm text-gray-600 mt-2">${s.submissionText}</p>` : ''}
          ${s.submissionFileUrl ? `<a href="${s.submissionFileUrl}" target="_blank" class="text-sm theme-accent font-semibold hover:underline mt-1 inline-block">View submitted file</a>` : ''}

          <div class="flex flex-wrap items-center gap-2 mt-3 bg-gray-50 border border-gray-200 rounded-lg p-3">
            <input type="number" id="grade-${s.submissionId}" value="${s.grade || ''}" placeholder="${s.maxScore ? 'Grade / ' + s.maxScore : 'Grade'}" min="0" ${s.maxScore ? 'max="' + s.maxScore + '"' : ''} class="input-light p-2 rounded-lg w-28 text-sm">
            <input type="text" id="feedback-${s.submissionId}" value="${(s.feedback || '').replace(/"/g, '&quot;')}" placeholder="Feedback (optional)" class="input-light p-2 rounded-lg flex-1 min-w-[180px] text-sm">
            <button type="button" onclick="saveGrade('${s.submissionId}')" class="theme-bg-accent hover:bg-orange-600 text-white font-bold py-2 px-5 rounded-lg text-xs uppercase tracking-wide">Save</button>
          </div>
          <p id="gradeError-${s.submissionId}" class="hidden text-red-600 text-sm mt-2"></p>
        </div>
      `).join('');
}

function saveGrade(submissionId) {
  const errEl = document.getElementById('gradeError-' + submissionId);
  errEl.classList.add('hidden');
  const grade = document.getElementById('grade-' + submissionId).value;
  const feedback = document.getElementById('feedback-' + submissionId).value;

  Api.call('/api/tutor/submissions/grade', { submissionId, grade, feedback }, function () {
    loadSubmissions(); // refresh so the "Graded" badge updates
  }, function (err) {
    errEl.innerText = (err && err.message) || 'Something went wrong.';
    errEl.classList.remove('hidden');
  }, sessionToken);
}

// ============================ SET UP EXAMS ============================

function loadExams() {
  Api.call('/api/tutor/exams', {}, function (res) { renderExamsList(res.exams); }, function () { }, sessionToken);
}

function renderExamsList(exams) {
  const listEl = document.getElementById('examsList');
  const emptyEl = document.getElementById('examsEmpty');
  if (!exams || exams.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  listEl.innerHTML = exams.map(e => `
        <div class="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <p class="font-bold text-gray-800">${e.Title}</p>
          <p class="text-xs text-gray-400 mt-1">Sent ${e.DateSent || ''} ${e.DueDate ? '&middot; Due ' + e.DueDate : ''} &middot; Status: ${e.Status}</p>
          ${e.Instructions ? `<p class="text-sm text-gray-600 mt-2">${e.Instructions}</p>` : ''}
        </div>
      `).join('');
}

function createExamClick() {
  const errEl = document.getElementById('createExamError');
  errEl.classList.add('hidden');
  const title = document.getElementById('newExamTitle').value.trim();
  if (!title) {
    errEl.innerText = 'Please enter an exam title.';
    errEl.classList.remove('hidden');
    return;
  }

  const questionsRaw = document.getElementById('newExamQuestions').value;
  const questions = questionsRaw.split('\n').map(q => q.trim()).filter(Boolean);

  const btn = document.getElementById('createExamBtn');
  btn.disabled = true;
  Api.call('/api/tutor/exams/create', {
    title: title,
    instructions: document.getElementById('newExamInstructions').value,
    questions: questions,
    dueDate: document.getElementById('newExamDueDate').value,
  }, function () {
    btn.disabled = false;
    document.getElementById('newExamTitle').value = '';
    document.getElementById('newExamDueDate').value = '';
    document.getElementById('newExamInstructions').value = '';
    document.getElementById('newExamQuestions').value = '';
    loadExams();
  }, function (err) {
    btn.disabled = false;
    errEl.innerText = (err && err.message) || 'Something went wrong.';
    errEl.classList.remove('hidden');
  }, sessionToken);
}

// ============================ START NEW LECTURE ============================

function loadLectures() {
  Api.call('/api/tutor/lectures', {}, function (res) { renderLecturesList(res.lectures); }, function () { }, sessionToken);
}

function renderLecturesList(lectures) {
  const listEl = document.getElementById('lecturesList');
  const emptyEl = document.getElementById('lecturesEmpty');
  if (!lectures || lectures.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  listEl.innerHTML = lectures.map(l => `
        <div class="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <p class="font-bold text-gray-800">${l.Title}</p>
          <p class="text-xs text-gray-400 mt-1">${l.DateHeld || ''}</p>
          ${l.Description ? `<p class="text-sm text-gray-600 mt-2">${l.Description}</p>` : ''}
          ${l.MaterialURL ? `<a href="${l.MaterialURL}" target="_blank" class="text-sm theme-accent font-semibold hover:underline mt-1 inline-block">View material</a>` : ''}
        </div>
      `).join('');
}

function createLectureClick() {
  const errEl = document.getElementById('createLectureError');
  errEl.classList.add('hidden');
  const title = document.getElementById('newLectureTitle').value.trim();
  if (!title) {
    errEl.innerText = 'Please enter a lecture title.';
    errEl.classList.remove('hidden');
    return;
  }

  const file = document.getElementById('newLectureMaterial').files[0];
  const btn = document.getElementById('createLectureBtn');

  function proceed(materialData) {
    btn.disabled = true;
    Api.call('/api/tutor/lectures/create', {
      title: title,
      description: document.getElementById('newLectureDescription').value,
      dateHeld: document.getElementById('newLectureDate').value,
      materialData: materialData,
    }, function () {
      btn.disabled = false;
      document.getElementById('newLectureTitle').value = '';
      document.getElementById('newLectureDate').value = '';
      document.getElementById('newLectureDescription').value = '';
      document.getElementById('newLectureMaterial').value = '';
      loadLectures();
    }, function (err) {
      btn.disabled = false;
      errEl.innerText = (err && err.message) || 'Something went wrong.';
      errEl.classList.remove('hidden');
    }, sessionToken);
  }

  if (file) {
    const reader = new FileReader();
    reader.onload = function (e) { proceed(e.target.result); };
    reader.readAsDataURL(file);
  } else {
    proceed(null);
  }
}

// ============================ GRADE STUDENT / RESULTS ============================

function populateResultStudentSelect(students) {
  const select = document.getElementById('resultStudentSelect');
  select.innerHTML = '<option value="">Choose a student from your roster</option>' +
    students.map(s => `<option value="${s.regId}">${s.fullName} (${s.regId})</option>`).join('');
}

function saveResultClick() {
  const errEl = document.getElementById('saveResultError');
  const okEl = document.getElementById('saveResultSuccess');
  errEl.classList.add('hidden');
  okEl.classList.add('hidden');

  const regId = document.getElementById('resultStudentSelect').value;
  if (!regId) {
    errEl.innerText = 'Please choose a student.';
    errEl.classList.remove('hidden');
    return;
  }

  const btn = document.getElementById('saveResultBtn');
  btn.disabled = true;
  Api.call('/api/tutor/results/save', {
    regId: regId,
    ca: document.getElementById('resultCa').value,
    examObjectives: document.getElementById('resultExamObjectives').value,
    examPractical: document.getElementById('resultExamPractical').value,
  }, function (res) {
    btn.disabled = false;
    okEl.innerText = `Saved — Total: ${res.total}, Status: ${res.examStatus}`;
    okEl.classList.remove('hidden');
    loadDashboard(); // refresh roster + KPIs so the new score shows immediately
  }, function (err) {
    btn.disabled = false;
    errEl.innerText = (err && err.message) || 'Something went wrong.';
    errEl.classList.remove('hidden');
  }, sessionToken);
}

// ============================ SHARED ============================

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

function renderKpiCards(kpis) {
  const top = kpis.topPerformingStudent
    ? `${kpis.topPerformingStudent.fullName} (${kpis.topPerformingStudent.total})`
    : 'Not yet graded';
  const avg = kpis.averageClassScore === null || kpis.averageClassScore === undefined
    ? 'Not yet graded' : kpis.averageClassScore;

  const items = [
    { label: 'Total Students', value: kpis.totalStudents, icon: '👥' },
    { label: 'Total Assignments Submitted', value: kpis.totalAssignmentsSubmitted, icon: '📥' },
    { label: 'Top Performing Student', value: top, icon: '🏆' },
    { label: 'Average Class Score', value: avg, icon: '📊' },
    { label: 'Pending Grading Count', value: kpis.pendingGradingCount, icon: '⏳' },
  ];

  document.getElementById('kpiCardsGrid').innerHTML = items.map(item => `
        <div class="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <div class="text-2xl mb-2">${item.icon}</div>
          <p class="text-xs uppercase tracking-wide text-gray-500 font-bold mb-1">${item.label}</p>
          <p class="text-xl font-black text-gray-900">${item.value}</p>
        </div>
      `).join('');
}

function renderRoster(students) {
  const tbody = document.getElementById('rosterTableBody');
  if (!students || students.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-gray-400">No students yet.</td></tr>';
    return;
  }
  tbody.innerHTML = students.map(s => `
        <tr class="border-t border-gray-100">
          <td class="px-4 py-3 font-bold text-gray-800">${s.fullName || ''}</td>
          <td class="px-4 py-3 font-mono text-orange-600">${s.regId || ''}</td>
          <td class="px-4 py-3">${s.email || ''}</td>
          <td class="px-4 py-3">${s.phone || ''}</td>
          <td class="px-4 py-3">${s.paymentStatus || ''}</td>
          <td class="px-4 py-3 font-bold">${s.total === '' || s.total === null || s.total === undefined ? '—' : s.total}</td>
        </tr>
      `).join('');
}

function loadDashboard() {
  clearTimeout(loadWatchdog);
  loadWatchdog = setTimeout(function () {
    showLoadError('The server didn\u2019t respond in time. Your connection may be slow, or the portal may be temporarily unavailable.');
  }, 15000);

  Api.call('/api/tutor/dashboard', {}, function (res) {
    clearTimeout(loadWatchdog);
    try {
      document.getElementById('loadingScreen').classList.add('hidden');
      document.getElementById('portalRoot').classList.remove('hidden');

      renderSidebar('app-sidebar', NAV_ITEMS, 'home', function (navId) { handleNavClick(navId); }, 'Tutor Portal');
      renderHeader('app-header', 'Tutor Dashboard', res.tutorName || 'Tutor', doLogout);
      renderFooter('app-footer');

      if (!res.assigned) {
        document.getElementById('notAssignedBanner').classList.remove('hidden');
        document.getElementById('notAssignedCourse').innerText = `${res.course} (${res.category})`;
        document.getElementById('dashboardSection').classList.add('hidden');
      } else {
        document.getElementById('notAssignedBanner').classList.add('hidden');
        document.getElementById('dashboardSection').classList.remove('hidden');
        document.getElementById('courseLabel').innerText = `${res.course} (${res.category})`;
        renderKpiCards(res.kpis);
        renderRoster(res.students);
        currentRoster = res.students || [];
        populateResultStudentSelect(currentRoster);
      }
      showView('home');
    } catch (renderErr) {
      showLoadError('Something went wrong displaying your portal. Please try again.');
    }
  }, function (err) {
    clearTimeout(loadWatchdog);
    if (!dashboardRetried) {
      dashboardRetried = true;
      setTimeout(loadDashboard, 900);
      return;
    }
    showLoadError((err && err.message) || 'Something went wrong loading your portal.');
  }, sessionToken);
}

(function init() {
  sessionToken = sessionStorage.getItem('ahSessionToken');
  const role = sessionStorage.getItem('ahRole');
  if (!sessionToken || role !== 'tutor') {
    showNotLoggedIn();
    return;
  }
  loadDashboard();
})();
