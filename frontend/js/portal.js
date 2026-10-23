/* =============================================================================
   js/portal.js
   AH Student Hub — Student Portal logic. Ported from Portal.html's inline
   <script>. google.script.run calls become Api.call() against Flask's
   /api/student/* endpoints. The URL-token handoff (?token=...) and its
   history.replaceState scrub are dropped — see student-login's
   header note; the token now only ever travels via sessionStorage.
   ============================================================================= */

const ADMITTED_NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: '🏠' },
  { id: 'course', label: 'Course', icon: '📚' },
  { id: 'assignment', label: 'Assignment', icon: '📝' },
  { id: 'profile', label: 'Profile', icon: '👤' },
];
// Development Plan Section 6.3's Home/Course/Assignment nav items are
// unreachable until the student is Admitted — only Profile is offered.
const GATED_NAV_ITEMS = [
  { id: 'profile', label: 'Profile', icon: '👤' },
];

let sessionToken = null;
let currentDisplayName = '';

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById('view-' + id).classList.remove('hidden');
}

function doLogout() {
  Api.call('/api/auth/logout', {}, function () { }, function () { }, sessionToken);
  sessionStorage.removeItem('ahSessionToken');
  sessionStorage.removeItem('ahRole');
  sessionStorage.removeItem('ahDisplayName');
  window.location.href = 'student-login';
}

function showNotLoggedIn() {
  document.getElementById('loadingSpinnerState').classList.add('hidden');
  document.getElementById('loadingErrorState').classList.add('hidden');
  document.getElementById('notLoggedInState').classList.remove('hidden');
}

function populateProfile(profile) {
  document.getElementById('profRegId').innerText = profile.regId || '';
  document.getElementById('profName').innerText = profile.fullName || '';
  document.getElementById('profDob').innerText = profile.dob || '';
  document.getElementById('profGender').innerText = profile.gender || '';
  document.getElementById('profEmail').innerText = profile.email || '';
  document.getElementById('profPhone').innerText = profile.phone || '';
  document.getElementById('profIntake').innerText = profile.intakeMode || '';
  document.getElementById('profMode').innerText = profile.learningMode || '';
  document.getElementById('profPayment').innerText = profile.paymentStatus || '';
  document.getElementById('profAdmission').innerText = profile.admissionStatus || '';
  document.getElementById('profTotalFee').innerText = '₦' + (Number(profile.courseFee) || 0).toLocaleString();
  document.getElementById('profPassportImg').src = profile.passportUrl || '';
  document.getElementById('profCourses').innerHTML = (profile.courses || []).map(c =>
    `${c.course} <span class="text-gray-400">(${c.category})</span> — <span class="font-bold">₦${(Number(c.fee) || 0).toLocaleString()}</span>`
  ).join('<br>') || '<span class="text-gray-400">None recorded</span>';
}

function renderDashboardCards(cards) {
  const grid = document.getElementById('dashboardCardsGrid');
  const perf = cards.overallPerformance === null || cards.overallPerformance === undefined
    ? 'Not yet graded' : cards.overallPerformance;
  const rank = cards.leaderboard === null || cards.leaderboard === undefined
    ? 'Not ranked yet' : ('#' + cards.leaderboard);

  const items = [
    { label: 'Overall Performance', value: perf, icon: '📊' },
    { label: 'Number in Class', value: cards.numberInClass, icon: '👥' },
    { label: 'Leaderboard', value: rank, icon: '🏆' },
    { label: 'Pending Assignments', value: cards.pendingAssignments, icon: '⏳' },
    { label: 'Submitted Assignments', value: cards.submittedAssignments, icon: '✅' },
  ];

  grid.innerHTML = items.map(item => `
        <div class="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <div class="text-2xl mb-2">${item.icon}</div>
          <p class="text-xs uppercase tracking-wide text-gray-500 font-bold mb-1">${item.label}</p>
          <p class="text-2xl font-black text-gray-900">${item.value}</p>
        </div>
      `).join('');
}

function statusBadgeClass_(status) {
  if (status === 'Graded') return 'bg-blue-100 text-blue-700';
  if (status === 'Submitted') return 'bg-green-100 text-green-700';
  return 'bg-orange-100 text-orange-700';
}

function renderAssignments(assignments) {
  const listEl = document.getElementById('assignmentList');
  const emptyEl = document.getElementById('assignmentListEmpty');
  if (!assignments || assignments.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  listEl.innerHTML = assignments.map(a => {
    const closed = a.assignmentStatus === 'Closed';
    const canSubmit = !closed;
    const dueText = a.dueDate ? ('Due ' + a.dueDate) : '';
    const scoreText = a.maxScore ? (a.maxScore + ' pts') : '';
    const meta = [a.course, a.category ? ('(' + a.category + ')') : '', dueText, scoreText].filter(Boolean).join(' · ');

    let detailHtml = '';
    if (a.status !== 'Pending') {
      detailHtml = `<p class="text-sm text-gray-600 mt-2">Submitted ${a.submittedDate || ''}${a.submissionFileUrl ? ' &middot; <a href="' + a.submissionFileUrl + '" target="_blank" class="theme-accent font-semibold hover:underline">View my file</a>' : ''}</p>`;
      if (a.status === 'Graded') {
        detailHtml += `<p class="text-sm font-bold text-gray-800 mt-1">Marks: ${a.marks}${a.maxScore ? ' / ' + a.maxScore : ''}</p>`;
        if (a.feedback) detailHtml += `<p class="text-sm text-gray-600 mt-1">Feedback: ${a.feedback}</p>`;
      }
    }
    if (closed) {
      detailHtml += `<p class="text-xs text-gray-400 mt-2 italic">This assignment is closed and no longer accepting submissions.</p>`;
    }

    const submitButtonLabel = a.status === 'Pending' ? 'Submit Assignment' : 'Resubmit';

    return `
        <div class="bg-white border border-gray-200 rounded-lg p-4 shadow-sm" data-assignment-id="${a.assignmentId}">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="font-bold text-gray-800">${a.title || '(untitled)'}</p>
              ${a.description ? `<p class="text-sm text-gray-500 mt-1">${a.description}</p>` : ''}
              <p class="text-xs text-gray-400 mt-1">${meta}</p>
            </div>
            <span class="text-xs font-bold uppercase tracking-wide px-3 py-1 rounded-full whitespace-nowrap ${statusBadgeClass_(a.status)}">${a.status}</span>
          </div>

          ${detailHtml}

          ${canSubmit ? `
            <button type="button" onclick="toggleSubmitForm('${a.assignmentId}')" class="mt-3 text-sm theme-accent font-bold hover:underline">${submitButtonLabel}</button>
            <div id="submitForm-${a.assignmentId}" class="hidden mt-3 bg-gray-50 border border-gray-200 rounded-lg p-4">
              <textarea id="subText-${a.assignmentId}" placeholder="Write your response (optional if attaching a file)" class="input-light p-3 rounded-lg w-full mb-3" rows="3"></textarea>
              <input type="file" id="subFile-${a.assignmentId}" class="w-full text-gray-600 text-sm mb-3 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100">
              <button type="button" id="subBtn-${a.assignmentId}" onclick="submitAssignmentForm('${a.assignmentId}')" class="theme-bg-accent hover:bg-orange-600 text-white font-bold py-2 px-6 rounded-lg text-sm uppercase tracking-wide flex items-center gap-2">
                <span>Submit</span>
                <div id="subLoader-${a.assignmentId}" class="hidden loader border-2 border-t-2 border-gray-200 rounded-full w-4 h-4"></div>
              </button>
              <p id="subError-${a.assignmentId}" class="hidden text-red-600 text-sm mt-2"></p>
            </div>
          ` : ''}
        </div>`;
  }).join('');
}

function toggleSubmitForm(assignmentId) {
  document.getElementById('submitForm-' + assignmentId).classList.toggle('hidden');
}

function submitAssignmentForm(assignmentId) {
  const textEl = document.getElementById('subText-' + assignmentId);
  const fileEl = document.getElementById('subFile-' + assignmentId);
  const errEl = document.getElementById('subError-' + assignmentId);
  const btn = document.getElementById('subBtn-' + assignmentId);
  const loader = document.getElementById('subLoader-' + assignmentId);

  const text = textEl.value.trim();
  const file = fileEl.files[0];
  errEl.classList.add('hidden');

  if (!text && !file) {
    errEl.innerText = 'Please write a response or attach a file.';
    errEl.classList.remove('hidden');
    return;
  }

  function doSubmit(fileData, fileName) {
    btn.disabled = true;
    loader.classList.remove('hidden');
    Api.call('/api/student/assignments/submit', {
      assignmentId: assignmentId, submissionText: text, fileBase64: fileData, fileName: fileName,
    }, function () {
      btn.disabled = false;
      loader.classList.add('hidden');
      // Refresh from the server rather than guessing the new state
      // client-side — keeps the displayed status/marks/feedback always
      // exactly what's actually in the Submissions sheet.
      refreshAssignments();
    }, function (err) {
      btn.disabled = false;
      loader.classList.add('hidden');
      errEl.innerText = (err && err.message) || 'Something went wrong. Please try again.';
      errEl.classList.remove('hidden');
    }, sessionToken);
  }

  if (file) {
    const reader = new FileReader();
    reader.onload = function (e) { doSubmit(e.target.result, file.name); };
    reader.readAsDataURL(file);
  } else {
    doSubmit(null, null);
  }
}

function refreshAssignments() {
  Api.call('/api/student/assignments', {}, function (res) {
    renderAssignments(res.assignments);
  }, function () { /* silent — the list just stays as-is */ }, sessionToken);
}

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
    showLoadError('The server didn\u2019t respond in time. Your connection may be slow, or the portal may be temporarily unavailable.');
  }, 15000);

  Api.call('/api/student/dashboard', {}, function (res) {
    clearTimeout(loadWatchdog);
    try {
      currentDisplayName = (res.profile && res.profile.fullName) || 'Student';
      document.getElementById('loadingScreen').classList.add('hidden');
      document.getElementById('portalRoot').classList.remove('hidden');

      if (!res.admitted) {
        renderSidebar('app-sidebar', GATED_NAV_ITEMS, 'profile', showView, 'Student Portal');
        renderHeader('app-header', 'My Profile', currentDisplayName, doLogout);
        document.getElementById('notAdmittedBanner').classList.remove('hidden');
        document.getElementById('notAdmittedStatus').innerText = res.admissionStatus;
        document.getElementById('homeCardsSection').classList.add('hidden');
        populateProfile(res.profile);
        showView('profile');
      } else {
        renderSidebar('app-sidebar', ADMITTED_NAV_ITEMS, 'home', function (navId) { showView(navId); }, 'Student Portal');
        renderHeader('app-header', 'Home', currentDisplayName, doLogout);
        document.getElementById('notAdmittedBanner').classList.add('hidden');
        document.getElementById('homeCardsSection').classList.remove('hidden');
        renderDashboardCards(res.cards || {});
        renderAssignments(res.assignments || []);
        populateProfile(res.profile);
        showView('home');
      }
      renderFooter('app-footer');
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
  if (!sessionToken || role !== 'student') {
    showNotLoggedIn();
    return;
  }
  loadDashboard();
})();
