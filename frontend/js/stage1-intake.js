/* =============================================================================
   js/stage1-intake.js
   AH Student Hub — STAGE 1: Intake Mode. Ported from Stage1_IntakeScript.html
   unchanged in behaviour — INTAKE_MODES now comes from Flask's
   /api/public/config instead of an Apps Script scriptlet.
   ============================================================================= */

function renderIntakeCards() {
  const container = document.getElementById('intakeCardGroup');
  const closedMsg = document.getElementById('allIntakesClosedMessage');
  const loadingIndicator = document.getElementById('intakeLoadingIndicator');
  const anyOpen = INTAKE_MODES.some(function (m) { return m.isOpen; });

  loadingIndicator.classList.add('hidden');

  if (!anyOpen) {
    container.classList.add('hidden');
    closedMsg.classList.remove('hidden');
    document.getElementById('intakeContinueBtn').classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  container.innerHTML = INTAKE_MODES.map(function (m) {
    if (!m.isOpen) {
      return `
          <div class="bg-gray-50 border-2 border-gray-200 rounded-xl p-6 text-center opacity-60 cursor-not-allowed" aria-disabled="true">
            <span class="block text-lg font-black text-gray-500">${m.label}</span>
            <span class="block text-xs text-red-500 font-bold mt-2 uppercase tracking-wider">Closed</span>
          </div>`;
    }
    return `
        <button type="button"
          class="intake-card bg-white border-2 border-gray-200 rounded-xl p-6 text-center shadow-sm hover:shadow-md hover:border-orange-300 transition-all focus:outline-none"
          data-intake="${m.label}" onclick="selectIntake(this)">
          <span class="block text-lg font-black text-gray-900">${m.label}</span>
          <span class="block text-xs text-gray-400 mt-2 uppercase tracking-wider">Tap to select</span>
        </button>`;
  }).join('');
}

// Propagation rule (Development Plan Section 5): the Stage 1 choice
// drives the subtitle for the rest of the session. The confirmation
// email and the receipt both read the same #intakeMode hidden field this
// function sets, so all three surfaces stay in sync from this one value.
function updateIntakeHeader() {
  const intake = document.getElementById('intakeMode').value;
  const headerEl = document.getElementById('formIntakeHeader');
  headerEl.innerText = intake ? `${intake.toUpperCase()} APPLICATION FORM` : "SELECT AN INTAKE MODE BELOW";
  const chipEl = document.getElementById('intakeChip');
  if (chipEl) chipEl.innerText = intake;
}

function selectIntake(el) {
  document.querySelectorAll('.intake-card').forEach(function (c) {
    c.classList.remove('theme-border', 'bg-orange-50', 'ring-2', 'ring-orange-300');
    c.classList.add('border-gray-200');
  });
  el.classList.remove('border-gray-200');
  el.classList.add('theme-border', 'bg-orange-50', 'ring-2', 'ring-orange-300');

  document.getElementById('intakeMode').value = el.dataset.intake;

  const btn = document.getElementById('intakeContinueBtn');
  btn.disabled = false;
  btn.classList.remove('opacity-50', 'cursor-not-allowed');
}

function proceedFromIntake() {
  if (!document.getElementById('intakeMode').value) return;
  updateIntakeHeader();
  goToPage(1);
}
