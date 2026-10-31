/* Corporate public pages: lightweight navigation, contact routing and approved project photos. */
(function(){'use strict';
var $=function(s){return document.querySelector(s);}, config=window.APPLY_CONFIG||{};
var menu=$('#siteMenu'), toggle=$('#menuBtn');
if(menu&&toggle){function open(v){menu.classList.toggle('open',v);toggle.setAttribute('aria-expanded',String(v));toggle.textContent=v?'Close':'Menu';}
 toggle.addEventListener('click',function(){open(!menu.classList.contains('open'))});
 menu.addEventListener('click',function(e){if(e.target.closest('a'))open(false)});
 document.addEventListener('keydown',function(e){if(e.key==='Escape'&&menu.classList.contains('open')){open(false);toggle.focus()}});
 window.addEventListener('resize',function(){if(window.innerWidth>1180)open(false)});
}
var yr=$('#yr');if(yr)yr.textContent=String(new Date().getFullYear());
function address(s){var l=s&&s.location||{},row=$('#publicAddressRow'),txt=$('#publicAddress'),map=$('#publicMap');if(!row||!txt||!map)return;
 if(!l.published_at||!l.address||!l.city||!l.state){row.hidden=true;return;}
 txt.textContent=[l.address,l.city,l.lga,l.state,'Nigeria'].filter(Boolean).join(', ');
 var lat=Number(l.lat),lon=Number(l.lon),valid=l.lat!=null&&l.lon!=null&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;
 map.hidden=!valid;if(valid)map.href='https://www.openstreetmap.org/?mlat='+encodeURIComponent(lat)+'&mlon='+encodeURIComponent(lon)+'#map=16/'+encodeURIComponent(lat)+'/'+encodeURIComponent(lon);row.hidden=false;
}
window.addEventListener('site-settings',function(e){address(e.detail||{})});if(window.SITE)address(window.SITE);
var sel=$('#cSvc');
function setService(){if(!sel)return;var params=new URLSearchParams(location.search);var requested=params.get('service');if(requested&&Array.from(sel.options).some(function(o){return o.value===requested;}))sel.value=requested;}
setService();
document.addEventListener('click',function(e){var a=e.target.closest('[data-service]');if(a&&sel)sel.value=a.getAttribute('data-service')});
var form=$('#consultForm');if(form)form.addEventListener('submit',function(e){e.preventDefault();var n=$('#cName').value.trim(),p=$('#cPhone').value.trim(),s=sel.value,m=$('#cMsg').value.trim(),err=$('#cErr');
if(!n||!s){err.textContent='Enter your name and select a service.';err.hidden=false;(!n?$('#cName'):sel).focus();return;}
err.hidden=true;var msg='Hello AH Consult, my name is '+n+(p?' ('+p+')':'')+'. I am interested in: '+s+'.'+(m?' '+m:'');
window.open('https://wa.me/2348037155105?text='+encodeURIComponent(msg),'_blank','noopener');
});
// Backward compatibility with homepage anchors that were relocated to Student Hub.
if(location.pathname==='/'||/\/index(?:\.html)?$/.test(location.pathname)){var redirect={training:'training',courses:'training',programs:'training',register:'register',apply:'register',admissions:'register',applicants:'portal-access',gallery:'gallery',impact:'impact'};
var anchorKey=decodeURIComponent(location.hash.slice(1));if(Object.prototype.hasOwnProperty.call(redirect,anchorKey)){location.replace('student-hub.html#'+encodeURIComponent(redirect[anchorKey]));return;}}
var stage=$('#project-highlights');if(!stage)return;
var base=String(config.SUPABASE_URL||'').replace(/\/$/,''),publicAnonKey=config.SUPABASE_ANON_KEY;
function info(message){stage.textContent='';var p=document.createElement('p');p.className='gallery-note';p.textContent=message;stage.appendChild(p)}
if(!base||!publicAnonKey){info('Project photographs will appear here when the published gallery is connected.');return;}
fetch(base+'/rest/v1/gallery_items?select=id,image_url,caption,alt_text&status=eq.published&category=eq.projects&order=sort_order.asc,created_at.asc&limit=3',{headers:{apikey:publicAnonKey},cache:'no-store'})
.then(function(r){if(!r.ok)throw Error('Gallery unavailable');return r.json()}).then(function(rows){if(!rows.length){info('New project photographs will appear here once published by the team.');return;}
stage.textContent='';rows.forEach(function(r){var f=document.createElement('figure');f.className='project-photo';var img=document.createElement('img');img.src=r.image_url;img.alt=r.alt_text||r.caption||'Published project photograph';img.loading='lazy';img.decoding='async';img.width=640;img.height=450;var cap=document.createElement('figcaption');cap.textContent=r.caption||'AH Consult project';f.append(img,cap);stage.appendChild(f)})}).catch(function(){info('Project photographs are temporarily unavailable.')});
})();
