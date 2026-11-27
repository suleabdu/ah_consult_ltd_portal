import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { zipSync, strToU8 } from 'fflate';

const dom=new JSDOM('',{runScripts:'outside-only'});
dom.window.TextDecoder=TextDecoder;
dom.window.eval(readFileSync('frontend/vendor/docx-zip.min.js','utf8'));
dom.window.eval(readFileSync('frontend/js/docx-import.js','utf8'));
const asFile=bytes=>({name:'vacancy.docx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
const doc=text=>strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
assert.equal(await dom.window.AHDocxText(asFile(zipSync({'word/document.xml':doc('Job &amp; duties')}))),'Job & duties');
await assert.rejects(dom.window.AHDocxText(asFile(zipSync({'word/document.xml':doc('x'.repeat(1100000))}))),/too (large|much)/i);
await assert.rejects(dom.window.AHDocxText(asFile(zipSync({'other.xml':doc('missing')}))),/not found/i);
await assert.rejects(dom.window.AHDocxText({name:'x.docx',size:3*1024*1024}),/no larger/i);
console.log('PASS Word import extracts plain text and rejects oversize or missing document content');
