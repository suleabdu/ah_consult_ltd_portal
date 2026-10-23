/* =============================================================================
   js/components.js
   AH Student Hub — shared sidebar / header / footer renderers

   Ported near verbatim from the original sidebar.html, header.html, and
   footer.html (Apps Script HTML includes) — these never called
   google.script.run themselves, so no API porting was needed, only the
   file format (an .html include -> a plain .js file loaded with <script
   src>).

   RESPONSIVENESS FIX: the original (and this file's earlier version)
   made the sidebar `hidden md:flex` — meaning on any phone-width screen
   it simply disappeared, with nothing replacing it, leaving no way at
   all to switch views on the Student/Tutor/Admin dashboards. This
   version turns the sidebar into a proper slide-in drawer on small
   screens (open via a hamburger button this file now also renders in
   the header, closed by tapping the backdrop, a nav item, or the
   hamburger again) while staying exactly as it was — a plain, always-
   visible fixed sidebar — at md: and above. Every page using these
   components (portal.html, tutor.html, admin-dashboard.html) needs its
   <aside id="app-sidebar"> tag's own class attribute updated to match
   (see MOBILE_SIDEBAR_BASE_CLASSES below) — done as part of this fix.
   ============================================================================= */

// Must match the <aside id="app-sidebar" class="..."> written in each
// dashboard page — kept as one named constant so it's obvious the two
// have to agree, rather than a magic string duplicated in three .html
// files with no visible link between them.
const MOBILE_SIDEBAR_BASE_CLASSES =
  'w-64 bg-white border-r border-gray-200 flex flex-col fixed inset-y-0 left-0 z-40 ' +
  'transform -translate-x-full transition-transform duration-300 ease-in-out md:translate-x-0';

function openMobileSidebar() {
  const sidebar = document.getElementById('app-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('-translate-x-full');
  if (backdrop) backdrop.classList.remove('hidden');
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('app-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.add('-translate-x-full');
  if (backdrop) backdrop.classList.add('hidden');
}

function toggleMobileSidebar() {
  const sidebar = document.getElementById('app-sidebar');
  if (sidebar && sidebar.classList.contains('-translate-x-full')) {
    openMobileSidebar();
  } else {
    closeMobileSidebar();
  }
}

// navItems: [{ id, label, icon }]. onSelect(id) is called when a nav item
// is clicked; the calling page owns what happens next (showing/hiding its
// own view sections) — this component only renders and highlights.
function renderSidebar(containerId, navItems, activeId, onSelect, footerLabel) {
  const container = document.getElementById(containerId);
  container.className = MOBILE_SIDEBAR_BASE_CLASSES;
  container.innerHTML = `
      <div class="flex items-center justify-between gap-3 px-6 py-6 border-b border-gray-200">
        <div class="flex items-center gap-3">
          <img src="https://lh3.googleusercontent.com/d/1Qp_nbC6oekgdzjJqGBHwHw125t1ABYUf" alt="AH Logo" class="h-9 w-auto object-contain">
          <span class="font-extrabold text-sm uppercase tracking-wide"><span class="text-black">AH</span> <span class="theme-accent">HUB</span></span>
        </div>
        <button type="button" onclick="closeMobileSidebar()" class="md:hidden text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Close menu">&times;</button>
      </div>
      <nav class="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        ${navItems.map(item => `
          <button type="button" data-nav-id="${item.id}"
            class="sidebar-nav-item w-full text-left px-4 py-3 rounded-lg font-bold text-sm uppercase tracking-wide transition-colors flex items-center gap-3 ${item.id === activeId ? 'theme-bg-accent text-white' : 'text-gray-600 hover:bg-gray-100'}">
            <span>${item.icon || ''}</span> ${item.label}
          </button>
        `).join('')}
      </nav>
      ${footerLabel ? `<div class="px-6 py-4 border-t border-gray-200 text-xs text-gray-400">${footerLabel}</div>` : ''}
    `;
  container.querySelectorAll('.sidebar-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.sidebar-nav-item').forEach(b => {
        b.classList.remove('theme-bg-accent', 'text-white');
        b.classList.add('text-gray-600');
      });
      btn.classList.remove('text-gray-600');
      btn.classList.add('theme-bg-accent', 'text-white');
      onSelect(btn.dataset.navId);
      closeMobileSidebar(); // a no-op at md: and above (already translate-x-0)
    });
  });
}

function renderHeader(containerId, title, userName, onLogout) {
  const container = document.getElementById(containerId);
  container.innerHTML = `
      <div class="flex items-center justify-between px-4 md:px-6 py-4 bg-white border-b border-gray-200 shadow-sm">
        <div class="flex items-center gap-3 min-w-0">
          <button type="button" onclick="openMobileSidebar()" class="md:hidden text-gray-600 hover:text-gray-900 text-xl leading-none flex-shrink-0" aria-label="Open menu">&#9776;</button>
          <h1 class="text-base md:text-xl font-black text-gray-900 uppercase tracking-wide truncate">${title}</h1>
        </div>
        <div class="flex items-center gap-2 md:gap-4 flex-shrink-0">
          <span class="text-sm text-gray-600 hidden sm:inline">Hi, <strong class="text-gray-900">${userName}</strong></span>
          <button type="button" id="headerLogoutBtn" class="text-sm theme-accent font-bold hover:underline whitespace-nowrap">Log out</button>
        </div>
      </div>
    `;
  document.getElementById('headerLogoutBtn').addEventListener('click', onLogout);
}

function renderFooter(containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = `
      <div class="px-6 py-4 text-center text-xs text-gray-400 border-t border-gray-200 bg-white">
        &copy; ${new Date().getFullYear()} AH Consult Ltd — AH Student Hub
      </div>
    `;
}
