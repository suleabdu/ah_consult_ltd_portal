// Behavioural test for the passport-photo compressor in frontend/apply.html (simulated canvas/bitmap; no browser needed).
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../../frontend/js/pages/apply.js', import.meta.url), 'utf8');
const src = html.slice(html.indexOf('async function compress(file){'), html.indexOf('async function saveFormDraft(){'));
// simulated browser: JPEG size ~ pixels * quality * 0.35 bytes (a realistic photo-ish estimate)
function env({w,h,type='image/jpeg',size=2_000_000,bitmapFails=false,toBlobNull=false,bytesPerPx=0.35}){
  const calls=[];
  const document={createElement:()=>({set width(v){this._w=v},get width(){return this._w},set height(v){this._h=v},get height(){return this._h},getContext:()=>({fillRect(){},drawImage(){},set fillStyle(v){}}),
    toBlob(cb,mime,q){ calls.push([this._w,this._h,q]); cb(toBlobNull?null:{size:Math.round(this._w*this._h*q*bytesPerPx),type:mime}); }})};
  const createImageBitmap=async()=>{ if(bitmapFails) throw new Error('no'); return {width:w,height:h,close(){}} };
  const URL={createObjectURL:()=>'blob:x',revokeObjectURL(){}}; class Image{set src(v){ setTimeout(()=>this.onload&&this.onload(),0); } get width(){return w} get height(){return h} get naturalWidth(){return w} get naturalHeight(){return h}}
  const f=new Function('document','createImageBitmap','URL','Image',src+';return compress;')(document,createImageBitmap,URL,Image);
  return {compress:f,calls,file:{type,size,name:'p.jpg'}};
}
let pass=0,fail=0; const ok=(n,c)=>{c?pass++:fail++;console.log((c?'PASS ':'FAIL ')+n)};
const rejects=async(p)=>{try{await p;return null}catch(e){return e.message}};
{ const e=env({w:4000,h:3000}); const b=await e.compress(e.file); ok('large phone photo ends under 100 KB (got '+Math.round(b.size/1024)+' KB)', b.size<=95*1024); ok('output is image/jpeg', b.type==='image/jpeg'); ok('scaled to <=600px', e.calls[0][0]<=600&&e.calls[0][1]<=600); }
{ const e=env({w:640,h:800,bytesPerPx:0.5}); const b=await e.compress(e.file); ok('quality/size loop converges', b.size<=95*1024&&e.calls.length>1); }
{ const e=env({w:3000,h:3000,bytesPerPx:6}); const b=await e.compress(e.file); ok('very heavy image still shrinks (got '+Math.round(b.size/1024)+' KB)', b.size<=95*1024); }
{ const e=env({w:400,h:500,type:'image/png'}); const b=await e.compress(e.file); ok('PNG accepted and re-encoded as JPEG', b.type==='image/jpeg'); }
{ const e=env({w:800,h:800,bitmapFails:true}); const b=await e.compress(e.file); ok('falls back to <img> decoding when createImageBitmap fails', b.size>0); }
{ const e=env({w:800,h:800,type:'application/pdf'}); ok('PDF rejected with clear message', /JPEG or PNG/.test(await rejects(e.compress(e.file)))); }
{ const e=env({w:800,h:800,type:'image/gif'}); ok('GIF rejected', /JPEG or PNG/.test(await rejects(e.compress(e.file)))); }
{ const e=env({w:800,h:800,size:20_000_000}); ok('20 MB input rejected', /too large/.test(await rejects(e.compress(e.file)))); }
{ const e=env({w:120,h:150}); ok('tiny image rejected', /too small/.test(await rejects(e.compress(e.file)))); }
{ const e=env({w:800,h:800,toBlobNull:true}); ok('toBlob failure gives friendly error', /could not process/.test(await rejects(e.compress(e.file)))); }
{ const e=env({w:800,h:800}); ok('no file gives friendly error', /Choose a passport/.test(await rejects(e.compress(null)))); }
{ const e=env({w:2000,h:2000,bytesPerPx:400}); ok('impossible image fails gracefully, not a crash', /could not be reduced/.test(await rejects(e.compress(e.file)))); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
