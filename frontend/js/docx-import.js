(function () {
 'use strict';
 // Extract only Word's main text document. No HTML, relationships, macros,
 // embedded files or external resources are rendered or followed.
 window.AHDocxText = async function (file,options) {
  // Recruitment previews can opt into larger, still bounded documents; the
  // vacancy import retains its original strict defaults.
  const o=options||{},limit=(value,minimum,maximum)=>Number.isFinite(value)?Math.max(minimum,Math.min(maximum,Math.floor(value))):minimum;
  const maxFile=limit(o.maxFileBytes,2*1024*1024,10*1024*1024),maxXml=limit(o.maxXmlBytes,1024*1024,4*1024*1024),maxChars=limit(o.maxChars,30000,200000);
  if (!file || !/\.docx$/i.test(file.name) || file.size<4 || file.size>maxFile) throw Error('Choose a DOCX file no larger than '+Math.floor(maxFile/(1024*1024))+' MB.');
  if (!window.AHZip) throw Error('Word import is unavailable. Refresh and try again.');
  const bytes=new Uint8Array(await file.arrayBuffer()), chunks=[];
  let entries=0, matches=0, size=0, complete=false;
  const unzip=new window.AHZip.Unzip(entry=>{
   if(++entries>150)throw Error('This document has too many components.');
   if(entry.name!=='word/document.xml')return;
   if(++matches!==1 || (entry.originalSize!=null && entry.originalSize>maxXml))throw Error('This Word document is too large or invalid.');
   entry.ondata=(error,chunk,final)=>{
    if(error)throw Error('This Word document could not be opened.');
    size+=chunk.length;if(size>maxXml)throw Error('This Word document contains too much text.');
    chunks.push(chunk);if(final)complete=true;
   };
   entry.start();
  });
  unzip.register(window.AHZip.UnzipInflate);
  try{for(let i=0;i<bytes.length;i+=2048)unzip.push(bytes.subarray(i,Math.min(i+2048,bytes.length)),i+2048>=bytes.length)}catch(e){throw Error(e.message||'This Word document could not be opened.')}
  if(matches!==1||!complete)throw Error('A readable Word document was not found.');
  const joined=new Uint8Array(size);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length}
  const xml=new TextDecoder('utf-8',{fatal:true}).decode(joined);
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('This Word document contains unsupported XML.');
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.querySelector('parsererror'))throw Error('This Word document contains invalid text.');
  const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const paragraphs=Array.from(doc.getElementsByTagNameNS(ns,'p')).map(p=>{
   let text='';for(const node of p.getElementsByTagNameNS(ns,'*')){if(node.localName==='t')text+=node.textContent||'';else if(node.localName==='tab')text+='\t';else if(node.localName==='br')text+='\n'}return text;
  });
  const result=paragraphs.join('\n').trim();if(!result)throw Error('No readable text was found in the Word document.');
  if(result.length>maxChars)throw Error('The document text exceeds the allowed preview length.');
  return result;
 };
})();
