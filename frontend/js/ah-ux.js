/* AH STUDENT HUB Phase 4 — small, dependency-free UX/accessibility layer. */
(function(){
  try {
    document.documentElement.style.scrollBehavior = 'smooth';
    var main=document.querySelector('main');
    if(main && !main.id) main.id='main-content';
    var nav=document.querySelector('nav');
    if(nav && !nav.getAttribute('aria-label')) nav.setAttribute('aria-label','Primary navigation');
    document.querySelectorAll('a[target="_blank"]').forEach(function(a){
      if(!a.rel) a.rel='noopener';
      if(!a.getAttribute('aria-label') && !a.textContent.trim()) a.setAttribute('aria-label','Open link in new tab');
    });
    document.addEventListener('keydown',function(e){
      if(e.key==='Escape') document.querySelectorAll('.mdl').forEach(function(m){ if(m.parentNode) m.remove(); });
    });
  } catch(e) { /* enhancement only; never block the application */ }
})();
