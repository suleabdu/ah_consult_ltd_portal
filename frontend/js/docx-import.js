(function () {
 'use strict';
 // Extract only Word's main text document. No HTML, relationships, macros,
 // embedded files or external resources are rendered or followed.
 window.AHDocxText = async function (file) {
  if (!file || !/\.docx$/i.test(file.name) || file.size<4 || file.size>2*1024*1024) throw Error('Choose a DOCX file no larger than 2 MB.');
  if (!window.AHZip) throw Error('Word import is unavailable. Refresh and try again.');
  const bytes=new Uint8Array(await file.arrayBuffer()), chunks=[];
  let entries=0, matches=0, size=0, complete=false;
  const unzip=new window.AHZip.Unzip(entry=>{
   if(++entries>150)throw Error('This document has too many components.');
   if(entry.name!=='word/document.xml')return;
   if(++matches!==1 || (entry.originalSize!=null && entry.originalSize>1024*1024))throw Error('This Word document is too large or invalid.');
   entry.ondata=(error,chunk,final)=>{
    if(error)throw Error('This Word document could not be opened.');
    size+=chunk.length;if(size>1024*1024)throw Error('This Word document contains too much text.');
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
  if(result.length>30000)throw Error('The imported text exceeds 30,000 characters.');
  return result;
 };
})();
