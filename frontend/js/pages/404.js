(function(){
    var map={
      '/apply':'/apply.html','/student-login':'/student-login.html','/staff-login':'/staff-login.html',
      '/admin-register':'/admin-register.html','/tutor':'/tutor.html','/admin-dashboard':'/admin-dashboard.html',
      '/portal':'/portal.html','/payment-success':'/payment-success.html','/forgot-password':'/forgot-password.html'
    };
    var target=map[location.pathname.replace(/\/$/,'')];
    if(target){ location.replace(target+location.search+location.hash); return; }
    document.getElementById('m').textContent='The requested page could not be found.';
  })();
