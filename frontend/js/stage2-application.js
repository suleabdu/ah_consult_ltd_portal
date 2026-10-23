/* =============================================================================
   js/stage2-application.js
   AH Student Hub — STAGE 2: Application form (personal details + course
   cart). Ported from Stage2_ApplicationScript.html — SURVEY_FIELDS,
   CATEGORIES and categoryFees now come from Flask's /api/public/config.
   ============================================================================= */

function renderSurveyFields() {
  const container = document.getElementById('part1Fields');
  container.innerHTML = SURVEY_FIELDS.map(renderSurveyField_).join('');

  const passportInput = document.getElementById('passportImage');
  if (passportInput) {
    passportInput.addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function (event) { base64Passport = event.target.result; };
        reader.readAsDataURL(file);
      }
    });
  }
}

function renderSurveyField_(field) {
  const requiredAttr = field.required ? 'required' : '';
  const label = escapeHtml_(field.label);

  if (field.type === 'select_one') {
    const options = (field.choices || []).map(function (c) {
      return `<option value="${escapeHtml_(c.value)}">${escapeHtml_(c.label)}</option>`;
    }).join('');
    return `<select id="${field.name}" ${requiredAttr} class="input-light p-3 rounded-lg w-full transition-shadow">
        <option value="">${label}</option>${options}
      </select>`;
  }
  if (field.type === 'textarea') {
    return `<textarea id="${field.name}" placeholder="${label}" ${requiredAttr} class="input-light p-3 rounded-lg w-full md:col-span-2 transition-shadow"></textarea>`;
  }
  if (field.type === 'date') {
    return `<input type="date" id="${field.name}" ${requiredAttr} class="input-light p-3 rounded-lg w-full transition-shadow text-gray-500" onfocus="this.style.color='#111827'">`;
  }
  if (field.type === 'email') {
    return `<input type="email" id="${field.name}" placeholder="${label}" ${requiredAttr} class="input-light p-3 rounded-lg w-full transition-shadow">`;
  }
  if (field.type === 'file') {
    return `<div class="md:col-span-2 bg-white p-4 border border-gray-200 rounded-lg shadow-sm">
        <label class="block font-bold mb-2 text-gray-700">${label}</label>
        <input type="file" id="${field.name}" accept="image/*" ${requiredAttr} class="w-full text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100">
      </div>`;
  }
  return `<input type="text" id="${field.name}" placeholder="${label}" ${requiredAttr} class="input-light p-3 rounded-lg w-full transition-shadow">`;
}

function escapeHtml_(value) {
  const div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}

function renderCategoryOptions() {
  const select = document.getElementById('category');
  CATEGORIES.forEach(function (cat) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });
}

// Live preview of the course/category currently picked — NOT yet added to
// the enrollment cart. currentFeeAmount (used on the Payment page) is only
// ever set from the cart total, in updateFeeTotals() below.
function updateCourseDetails() {
  const category = document.getElementById('category').value;
  const detailsBox = document.getElementById('dynamicDetails');
  if (category && categoryFees.hasOwnProperty(category)) {
    document.getElementById('displayFee').innerText = "₦" + categoryFees[category].toLocaleString();
    document.getElementById('displayOutcomes').innerText = categoryOutcomes[category] || "";
    detailsBox.classList.remove('hidden');
  } else {
    detailsBox.classList.add('hidden');
  }
}

// --- Course enrollment cart ---
function addCourseToCart() {
  const course = document.getElementById('course').value;
  const category = document.getElementById('category').value;
  if (!course || !category) {
    alert("Please choose both a course and a category before adding it.");
    return;
  }
  if (selectedCourses.some(c => c.course === course)) {
    alert(`${course} has already been added. Remove it below first if you want to change its category.`);
    return;
  }

  selectedCourses.push({ course: course, category: category, fee: categoryFees[category] });
  renderCourseCart();

  document.getElementById('course').value = "";
  document.getElementById('category').value = "";
  document.getElementById('dynamicDetails').classList.add('hidden');
}

function removeCourseFromCart(index) {
  selectedCourses.splice(index, 1);
  renderCourseCart();
}

function renderCourseCart() {
  const listEl = document.getElementById('courseCartList');
  const emptyEl = document.getElementById('courseCartEmpty');
  const totalRow = document.getElementById('courseCartTotalRow');

  if (selectedCourses.length === 0) {
    listEl.innerHTML = "";
    emptyEl.classList.remove('hidden');
    totalRow.classList.add('hidden');
    updateFeeTotals();
    return;
  }

  emptyEl.classList.add('hidden');
  totalRow.classList.remove('hidden');

  listEl.innerHTML = selectedCourses.map(function (c, i) {
    return `
        <div class="flex justify-between items-center bg-white border border-gray-200 rounded-lg px-4 py-3 shadow-sm">
          <div>
            <span class="font-bold text-gray-800">${c.course}</span>
            <span class="text-gray-500 text-sm"> — ${c.category}</span>
          </div>
          <div class="flex items-center gap-4">
            <span class="font-bold theme-accent">₦${c.fee.toLocaleString()}</span>
            <button type="button" onclick="removeCourseFromCart(${i})" class="text-red-500 hover:text-red-700 font-bold text-lg leading-none" aria-label="Remove ${c.course}">&times;</button>
          </div>
        </div>`;
  }).join("");

  updateFeeTotals();
}

function updateFeeTotals() {
  currentFeeAmount = selectedCourses.reduce((sum, c) => sum + c.fee, 0);
  document.getElementById('cartTotalFee').innerText = "₦" + currentFeeAmount.toLocaleString();
  document.getElementById('checkoutFee').innerText = "₦" + currentFeeAmount.toLocaleString();
}

function validateAndProceedToPayment() {
  const form = document.getElementById('applicationForm');
  if (!form.reportValidity()) return;
  if (selectedCourses.length === 0) {
    alert("Please add at least one course before continuing to Payment.");
    return;
  }
  goToPage(2);
  loadTemporaryAccount();
}
