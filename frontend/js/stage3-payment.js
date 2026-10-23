/* =============================================================================
   js/stage3-payment.js
   AH Student Hub — STAGE 3: Payment + final submission. Ported from
   Stage3_PaymentScript.html. The two google.script.run calls
   (getTemporaryAccountDetails, processRegistration) are now Api.call()
   against Flask's /api/public/payment-account and /api/public/register.
   ============================================================================= */

document.getElementById('paymentReceiptImage').addEventListener('change', function (e) {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function (event) { base64Receipt = event.target.result; };
    reader.readAsDataURL(file);
  }
});

function loadTemporaryAccount() {
  if (paymentReference) return;
  paymentReference = "AHCT-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).substring(2, 6).toUpperCase();

  Api.get(
    "/api/public/payment-account?reference=" + encodeURIComponent(paymentReference),
    function (account) {
      document.getElementById('acctBankName').innerText = account.bankName;
      document.getElementById('acctNumber').innerText = account.accountNumber;
      document.getElementById('acctName').innerText = account.accountName;
      document.getElementById('acctReference').innerText = account.reference;
      startAccountCountdown(account.validForMinutes || 30);
    },
    function (err) {
      document.getElementById('tempAccountBox').innerHTML = '<p class="text-red-600 text-sm font-bold">Could not load payment account details. Please refresh and try again.</p>';
    }
  );
}

function startAccountCountdown(minutes) {
  let remaining = minutes * 60;
  const el = document.getElementById('acctCountdown');
  clearInterval(acctCountdownInterval);
  acctCountdownInterval = setInterval(() => {
    remaining--;
    const m = Math.floor(remaining / 60).toString().padStart(2, '0');
    const s = (remaining % 60).toString().padStart(2, '0');
    el.innerText = `${m}:${s}`;
    if (remaining <= 0) {
      clearInterval(acctCountdownInterval);
      el.innerText = "Expired";
      el.classList.add('bg-red-100', 'text-red-700');
    }
  }, 1000);
}

function confirmPayment() {
  if (!base64Receipt) {
    alert("Please upload your payment receipt before confirming payment.");
    return;
  }

  document.getElementById('payBtn').classList.add('hidden');
  const loader = document.getElementById('paymentLoader');
  loader.classList.remove('hidden');
  loader.classList.add('flex');

  const totalSeconds = 25;
  let secondsLeft = totalSeconds;
  const countdownEl = document.getElementById('paymentCountdown');
  countdownEl.innerText = secondsLeft;
  const progressBar = document.getElementById('paymentProgressBar');

  const interval = setInterval(() => {
    try {
      secondsLeft--;
      countdownEl.innerText = Math.max(secondsLeft, 0);
      const pct = Math.min(100, Math.round(((totalSeconds - secondsLeft) / totalSeconds) * 100));
      progressBar.style.width = pct + "%";
      if (secondsLeft <= 0) clearInterval(interval);
    } catch (tickErr) {
      clearInterval(interval);
    }
  }, 1000);

  setTimeout(() => {
    clearInterval(interval);
    try {
      loader.classList.add('hidden');
      loader.classList.remove('flex');
      document.getElementById('paymentSuccessMsg').classList.remove('hidden');
      document.getElementById('submitDataBtn').classList.remove('hidden');
    } catch (completeErr) {
      loader.classList.add('hidden');
      const btn = document.getElementById('submitDataBtn');
      if (btn) btn.classList.remove('hidden');
    }
  }, totalSeconds * 1000);
}

function submitFinalData() {
  document.getElementById('submitDataBtn').classList.add('hidden');
  const submitLoader = document.getElementById('submitLoader');
  submitLoader.classList.remove('hidden');
  submitLoader.classList.add('flex');

  const payload = {};
  SURVEY_FIELDS.forEach(function (field) {
    if (field.type === 'file') return;
    const el = document.getElementById(field.name);
    if (el) payload[field.name] = el.value;
  });

  payload.intakeMode = document.getElementById('intakeMode').value;
  payload.courses = selectedCourses.map(c => ({ course: c.course, category: c.category }));
  payload.learningMode = document.getElementById('learningMode').value;
  payload.passportData = base64Passport;
  payload.receiptData = base64Receipt;
  payload.paymentReference = paymentReference;
  payload.paymentStatus = "Paid";

  Api.call(
    "/api/public/register",
    payload,
    function (response) {
      if (response.duplicate) {
        renderDuplicateReceipt(response);
        goToPage(3);
        return;
      }

      document.getElementById('duplicateNotice').classList.add('hidden');
      document.getElementById('receiptIntakeHeader').innerText = `${payload.intakeMode.toUpperCase()} APPLICATION FORM`;
      document.getElementById('receiptSubHeader').innerText = selectedCourses.map(c => c.course).join(', ') + ' — enrollment confirmed';
      document.getElementById('recAppNo').innerText = response.regId;
      document.getElementById('recIntake').innerText = payload.intakeMode;
      document.getElementById('recName').innerText = payload.fullName;
      document.getElementById('recDob').innerText = payload.dob;
      document.getElementById('recGender').innerText = payload.gender;
      document.getElementById('recEmail').innerText = payload.email;
      document.getElementById('recPhone').innerText = payload.phone;
      document.getElementById('recCourses').innerHTML = selectedCourses.map(c =>
        `${c.course} <span class="text-gray-400">(${c.category})</span> — <span class="font-bold">₦${c.fee.toLocaleString()}</span>`
      ).join('<br>');
      document.getElementById('recTotalFee').innerText = "₦" + currentFeeAmount.toLocaleString();
      document.getElementById('recMode').innerText = payload.learningMode;
      document.getElementById('recPassportImg').src = payload.passportData;
      document.getElementById('recEmailNotice').innerText = payload.email;
      document.getElementById('recLoginLink').href = 'student-login';

      goToPage(3);
    },
    function (err) {
      alert("Something went wrong: " + (err.message || err));
      document.getElementById('submitDataBtn').classList.remove('hidden');
      submitLoader.classList.add('hidden');
      submitLoader.classList.remove('flex');
    }
  );
}

function renderDuplicateReceipt(response) {
  const r = response.receipt;
  document.getElementById('duplicateNotice').classList.remove('hidden');
  document.getElementById('duplicateNotice').innerText = response.message || "You've already submitted this application. This is your original Registration Summary.";

  document.getElementById('receiptIntakeHeader').innerText = `${(r.intakeMode || '').toUpperCase()} APPLICATION FORM`;
  document.getElementById('receiptSubHeader').innerText = (r.courses || []).map(c => c.course).join(', ') + ' — enrollment confirmed';
  document.getElementById('recAppNo').innerText = r.regId;
  document.getElementById('recIntake').innerText = r.intakeMode;
  document.getElementById('recName').innerText = r.fullName;
  document.getElementById('recDob').innerText = r.dob;
  document.getElementById('recGender').innerText = r.gender;
  document.getElementById('recEmail').innerText = r.email;
  document.getElementById('recPhone').innerText = r.phone;
  document.getElementById('recCourses').innerHTML = (r.courses || []).map(c =>
    `${c.course} <span class="text-gray-400">(${c.category})</span> — <span class="font-bold">₦${(Number(c.fee) || 0).toLocaleString()}</span>`
  ).join('<br>');
  document.getElementById('recTotalFee').innerText = "₦" + (Number(r.totalFee) || 0).toLocaleString();
  document.getElementById('recMode').innerText = r.learningMode;
  document.getElementById('recPassportImg').src = r.passportUrl || '';
  document.getElementById('recEmailNotice').innerText = r.email;
  document.getElementById('recLoginLink').href = 'student-login';
}
