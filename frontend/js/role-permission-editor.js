(function () {
 'use strict';
 // The catalogue contains only permission modules enforced by the backend.
 const GROUPS=[
  ['Admissions & finance',['applications','payments','intakes']],
  ['Academic delivery',['courses','lecturers']],
  ['Website & branding',['media']],
  ['Recruitment & people',['recruitment','hr_activities']],
  ['Governance & system',['governance_team','governance_roles','governance_user_invite','governance_audit','governance_health']]
 ];
 // Only actions enforced by the database and server are listed here. These
 // controls deny actions; they never grant access beyond a module permission.
 const ACTIONS=[
  ['Recruitment · vacancies',[
   ['recruitment.vacancy.create','Create vacancies'],['recruitment.vacancy.edit','Edit vacancies'],['recruitment.vacancy.delete','Delete vacancies'],['recruitment.vacancy.publish','Publish vacancies']]],
  ['Recruitment · questions and applications',[
   ['recruitment.question.create','Create questions'],['recruitment.question.edit','Edit questions'],['recruitment.question.delete','Delete questions'],['recruitment.question.copy','Copy questions'],['recruitment.application.request_deletion','Request application deletion']]],
  ['Recruitment · applicant feedback',[
   ['recruitment.feedback.email','Send applicant email feedback'],['recruitment.feedback.whatsapp','Send applicant WhatsApp feedback']]],
  ['Governance · team',[
   ['governance.team.approve','Approve staff'],['governance.team.reject','Reject staff'],['governance.team.suspend','Suspend staff'],['governance.team.restore_pending','Return staff to pending'],['governance.team.assign_role','Assign staff roles']]],
  ['Governance · roles',[
   ['governance.role.create','Create custom roles'],['governance.role.edit','Edit custom roles'],['governance.role.delete','Delete custom roles']]]
 ];
 // These control dashboard navigation only. They do not grant data or task access.
 const TABS=[
  ['Admin · admissions & finance', [['admin.apps','Applications'],['admin.bulkImport','Bulk registration'],['admin.payments','Payments'],['admin.enrolment','Course enrolment'],['admin.deferments','Deferments'],['admin.intakes','Intakes']]],
  ['Admin · academic delivery', [['admin.courses','Course catalogue'],['admin.lecturers','Academics']]],
  ['Admin · documents & engagement', [['admin.documents','Documents'],['admin.docTemplates','Document designer'],['admin.media','Homepage gallery'],['admin.whatsapp','WhatsApp communications']]],
  ['Admin · governance & system', [['admin.intelligence','Reports & analytics'],['admin.sync','Sheet sync'],['admin.payset','Payment methods'],['admin.team','Staff & access'],['admin.perms','Role permissions'],['admin.site','Website settings'],['admin.audit','Audit trail'],['admin.health','System health'],['admin.release','Release checks'],['admin.archives','Archives'],['admin.recruitmentDeletion','Recruitment deletion requests'],['admin.danger','Restricted deletion']]],
  ['HR · recruitment', [['hr.vacancies','Vacancies'],['hr.applications','Applications']]],
  ['HR · people & development', [['hr.activities','Activities & refresher courses'],['hr.email','Email the team']]],
  ['HR · governance & system', [['hr.team','Team access'],['hr.roles','Roles & permissions'],['hr.invite','Invite staff'],['hr.audit','Audit trail'],['hr.health','System health']]]
 ];
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function mount(root,modules,permissionRows,role){
  const byId=new Map(modules.map(module=>[module[0],module]));
  const state=Object.fromEntries(modules.map(([id])=>[id,{level:(permissionRows.find(p=>p.role===role.code&&p.module===id)||{}).level||'none',shown:(role.dashboard_modules||[]).includes(id)}]));
  const levels=id=>id==='governance_audit'||id==='governance_health'?['none','read']:id==='governance_user_invite'?['none','write']:['none','read','write'];
  const levelLabel=(id,level)=>level==='none'?'No access':level==='read'?'View only':id==='governance_user_invite'?'Allow invitations':'View and edit';
  root.innerHTML='<div class="role-permission-editor"><p class="sub">Manage supported permission areas below. Some sensitive tasks remain restricted to designated roles; access to an area does not override those checks.</p><div class="tw role-permission-table-wrap"><table class="role-permission-table"><thead><tr><th scope="col">Permission area</th><th scope="col">Access</th><th scope="col">Dashboard</th><th scope="col">Action</th></tr></thead><tbody data-role-rows></tbody></table></div><p class="sub" data-role-empty hidden>No permissions selected. Use Add permission to choose an area.</p><button type="button" class="btn g" data-role-add aria-expanded="false">Add permission</button><div class="role-permission-browser" data-role-browser hidden><p class="sub">Expand a group and add a supported permission area.</p><div data-role-groups></div></div></div>';
  const rows=root.querySelector('[data-role-rows]'),empty=root.querySelector('[data-role-empty]'),browser=root.querySelector('[data-role-browser]'),add=root.querySelector('[data-role-add]'),groups=root.querySelector('[data-role-groups]');
  groups.innerHTML=GROUPS.map(([label,ids])=>`<details><summary>${esc(label)}</summary><div class="role-permission-options">${ids.filter(id=>byId.has(id)).map(id=>{const item=byId.get(id);return `<div class="role-permission-option"><div><strong>${esc(item[1])}</strong><small>${esc(item[2])}</small></div><button type="button" class="btn s g" data-role-include="${esc(id)}">Add</button></div>`}).join('')}</div></details>`).join('');
  function updateAddButtons(){groups.querySelectorAll('[data-role-include]').forEach(button=>{const entry=state[button.dataset.roleInclude],active=entry.level!=='none'||entry.shown;button.disabled=active;button.textContent=active?'Added':'Add';});}
  function renderRows(){
   const selected=modules.filter(([id])=>state[id].level!=='none'||state[id].shown);
   rows.innerHTML=selected.map(([id,label,description])=>{const entry=state[id];return `<tr><td><strong>${esc(label)}</strong><small>${esc(description)}</small></td><td><label class="role-sr-only" for="role-perm-${esc(id)}">Access for ${esc(label)}</label><select id="role-perm-${esc(id)}" class="sel" data-role-level="${esc(id)}">${levels(id).map(level=>`<option value="${level}" ${entry.level===level?'selected':''}>${esc(levelLabel(id,level))}</option>`).join('')}</select></td><td><label class="role-permission-toggle"><input type="checkbox" data-role-visible="${esc(id)}" ${entry.shown?'checked':''} ${entry.level==='none'?'disabled':''}> Show</label></td><td><button type="button" class="btn s g" data-role-remove="${esc(id)}" aria-label="Remove ${esc(label)} permission">Remove</button></td></tr>`;}).join('');
   empty.hidden=selected.length>0;
   rows.querySelectorAll('[data-role-level]').forEach(select=>select.onchange=()=>{const entry=state[select.dataset.roleLevel];entry.level=select.value;const checkbox=rows.querySelector(`[data-role-visible="${select.dataset.roleLevel}"]`);if(entry.level==='none'){entry.shown=false;checkbox.checked=false;}checkbox.disabled=entry.level==='none';updateAddButtons();});
   rows.querySelectorAll('[data-role-visible]').forEach(checkbox=>checkbox.onchange=()=>{state[checkbox.dataset.roleVisible].shown=checkbox.checked;});
   rows.querySelectorAll('[data-role-remove]').forEach(button=>button.onclick=()=>{state[button.dataset.roleRemove]={level:'none',shown:false};renderRows();updateAddButtons();});
  }
  add.onclick=()=>{browser.hidden=!browser.hidden;add.setAttribute('aria-expanded',String(!browser.hidden));};
  groups.querySelectorAll('[data-role-include]').forEach(button=>button.onclick=()=>{const id=button.dataset.roleInclude;state[id]={level:id==='governance_user_invite'?'write':'read',shown:true};renderRows();updateAddButtons();});
  renderRows();updateAddButtons();
  return {value:()=>({permissions:Object.fromEntries(modules.map(([id])=>[id,state[id].level])),modules:modules.filter(([id])=>state[id].shown).map(([id])=>id)})};
 }
 function mountActions(root,deniedActions){
  const denied=new Set(Array.isArray(deniedActions)?deniedActions:[]);
  root.innerHTML=`<section class="role-action-settings"><h4>Specific task restrictions</h4><p class="sub">Uncheck a task to deny it for this role. A checked task is available only when its permission area and the server's role rules also allow it. Other tasks continue to follow their existing permission-area rules.</p>${ACTIONS.map(([group,actions])=>`<details><summary>${esc(group)}</summary><div class="role-action-list">${actions.map(([id,label])=>`<label><input type="checkbox" data-role-action="${esc(id)}" ${denied.has(id)?'':'checked'}> ${esc(label)}</label>`).join('')}</div></details>`).join('')}</section>`;
  return {value:()=>[...root.querySelectorAll('[data-role-action]')].filter(input=>!input.checked).map(input=>input.dataset.roleAction)};
 }
 function mountTabs(root,hiddenTabs){
  const hidden=new Set(Array.isArray(hiddenTabs)?hiddenTabs:[]);
  root.innerHTML=`<section class="role-action-settings"><h4>Dashboard tab visibility</h4><p class="sub">Choose which tabs appear as available within each group. This changes navigation only; access still requires the applicable permission area and server-side task rules. Unchecked tabs remain visible as locked where their group is available.</p>${TABS.map(([group,tabs])=>`<details><summary>${esc(group)}</summary><div class="role-action-list">${tabs.map(([id,label])=>`<label><input type="checkbox" data-role-tab="${esc(id)}" ${hidden.has(id)?'':'checked'}> ${esc(label)}</label>`).join('')}</div></details>`).join('')}</section>`;
  return {value:()=>[...root.querySelectorAll('[data-role-tab]')].filter(input=>!input.checked).map(input=>input.dataset.roleTab)};
 }
 window.AHRolePermissionEditor={mount,mountActions,mountTabs};
})();
