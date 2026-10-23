/* =============================================================================
   js/core-state.js
   AH Student Hub — shared state & navigation for the 4-stage registration
   portal (apply.html). Ported from CoreState.html — the prices still come
   from the server (Flask's /api/public/config, mirroring Config.gs's
   CATEGORY_FEES) via the categoryFees constant apply injects, so this
   file and the backend can never charge two different amounts for the
   same category.
   ============================================================================= */

// Learning-outcomes copy is presentation-only and lives here, same as the
// original.
const categoryOutcomes = {
  'Beginner': "Navigate the software interface, create basic 2D drafts & simple 3D shapes.",
  'Intermediate': "Develop detailed floor plans, apply textures/lighting, generate technical documentation.",
  'Professional': "Master advanced BIM workflows, produce cinematic animations (Lumion), complex documentation.",
  'Full Package': "The complete path: Beginner through Professional curriculum for this course in one enrollment, plus a portfolio project and certification support.",
};

let base64Passport = "";
let base64Receipt = "";
let currentFeeAmount = 0;
let paymentReference = "";
let acctCountdownInterval = null;
let selectedCourses = []; // { course, category, fee } — one entry per "Add This Course" click

// Shared by every stage's "Continue"/"Back" controls. Stage numbers are
// 0-indexed here (0=Intake, 1=Application, 2=Payment) to match the
// page-N element IDs; the receipt (page-3) is reached only from
// stage3-payment.js's submitFinalData(), never from the progress bar.
function goToPage(pageNum) {
  document.querySelectorAll('#page-0, #page-1, #page-2, #page-3').forEach(el => el.classList.add('hidden-step'));
  document.getElementById(`page-${pageNum}`).classList.remove('hidden-step');

  if (pageNum <= 2) {
    const progressClasses = ['w-1/3', 'w-2/3', 'w-full'];
    const bar = document.getElementById('progress-bar');
    bar.className = `theme-bg-accent h-2 rounded transition-all duration-500 ${progressClasses[pageNum]}`;

    for (let i = 0; i <= 2; i++) {
      document.getElementById(`prog-${i}`).className = i <= pageNum ? 'text-black font-extrabold' : 'text-gray-500 font-bold';
    }
  }
}
