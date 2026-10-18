import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function freePort(){return await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})})}
async function waitFor(url,proc){for(let i=0;i<100;i++){if(proc.exitCode!==null)throw Error(`server exited with ${proc.exitCode}`);try{const r=await fetch(url);if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,50))}throw Error('server did not start')}

 test('API pública, configuração inicial, autenticação, validação e CRUD', async t=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'repapelie-test-'));
  await cp(path.join(project,'src'),path.join(temp,'src'),{recursive:true});
  await cp(path.join(project,'public'),path.join(temp,'public'),{recursive:true});
  await cp(path.join(project,'package.json'),path.join(temp,'package.json'));
  await mkdir(path.join(temp,'data','uploads'),{recursive:true});
  const port=await freePort();const token='test-setup-token-that-is-long-enough-12345';
  const proc=spawn(process.execPath,['src/server.js'],{cwd:temp,env:{...process.env,PORT:String(port),NODE_ENV:'test',ADMIN_INITIAL_SETUP_TOKEN:token,TRUSTED_ORIGIN:''},stdio:'ignore'});
  const base=`http://127.0.0.1:${port}`;
  t.after(async()=>{proc.kill('SIGTERM');await rm(temp,{recursive:true,force:true})});
  await waitFor(`${base}/api/public/health`,proc);
  let r=await fetch(`${base}/api/public/catalog`);assert.equal(r.status,200);let cat=await r.json();assert.equal(cat.settings.storeName,'Repapelie');assert.equal(cat.products.length,0);
  r=await fetch(`${base}/api/admin/products`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Produto indevido'})});assert.equal(r.status,401);
  r=await fetch(`${base}/api/admin/setup`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({setupToken:'wrong',username:'dona',password:'senha-muito-forte-123'})});assert.equal(r.status,403);
  r=await fetch(`${base}/api/admin/setup`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({setupToken:token,username:'dona',password:'senha-muito-forte-123'})});assert.equal(r.status,201);const cookie=r.headers.get('set-cookie').split(';')[0];
  r=await fetch(`${base}/api/admin/status`);assert.equal((await r.json()).authenticated,false,'sem cookie não deve autenticar');
  r=await fetch(`${base}/api/admin/data`,{headers:{cookie}});assert.equal(r.status,200);cat=await r.json();const category=cat.categories[0];
  r=await fetch(`${base}/api/admin/products`,{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({name:'Caderno Árvore',sku:'CAD-01',categoryId:category.id,shortDescription:'Capa botânica',description:'Caderno para anotações',image:'',gallery:[],priceMode:'fixed',priceCents:2590,availability:'available',options:[{id:'tema',label:'Tema',type:'select',choices:['Floral','Minimalista'],required:true,feeCents:0}],tags:['caderno'],active:true,published:true})});assert.equal(r.status,201);const product=await r.json();assert.equal(product.priceCents,2590);assert.equal(product.options[0].choices.length,2);
  r=await fetch(`${base}/api/public/catalog`);cat=await r.json();assert.equal(cat.products.length,1);assert.equal(cat.products[0].name,'Caderno Árvore');assert.equal(cat.products[0].priceCents,2590);
  r=await fetch(`${base}/api/admin/products`,{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({name:'Preço adulterado',categoryId:category.id,priceMode:'fixed',priceCents:-1,active:true,published:true})});assert.equal(r.status,400);
  r=await fetch(`${base}/api/admin/products`,{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({name:'Opções duplicadas',categoryId:category.id,priceMode:'quote',availability:'available',options:[{id:'same',label:'Tema',type:'select',choices:['A']},{id:'same',label:'Cor',type:'select',choices:['B']}],active:true,published:true})});assert.equal(r.status,400);
  r=await fetch(`${base}/api/admin/products`,{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({name:'Imagem externa',categoryId:category.id,priceMode:'quote',image:'https://example.com/evil.png',active:true,published:true})});assert.equal(r.status,400);
  r=await fetch(`${base}/api/admin/settings`,{method:'PUT',headers:{'content-type':'application/json',cookie},body:JSON.stringify({storeName:'Repapelie',whatsapp:'12345',catalogVisible:true})});assert.equal(r.status,400);
  r=await fetch(`${base}/api/admin/settings`,{method:'PUT',headers:{'content-type':'application/json',cookie},body:JSON.stringify({storeName:'Repapelie',whatsapp:'5511999999999',catalogVisible:true})});assert.equal(r.status,200);
  r=await fetch(`${base}/api/public/catalog`);cat=await r.json();assert.equal(cat.settings.whatsapp,'5511999999999');assert.equal(cat.settings.whatsappConfigured,true);
  r=await fetch(`${base}/api/admin/products/${product.id}`,{method:'PUT',headers:{'content-type':'application/json',cookie},body:JSON.stringify({...product,priceMode:'quote',priceCents:1234})});assert.equal(r.status,200);const edited=await r.json();assert.equal(edited.priceCents,null,'preço sob consulta não pode guardar preço numérico');
  r=await fetch(`${base}/api/admin/logout`,{method:'POST',headers:{'content-type':'application/json',cookie},body:'{}'});assert.equal(r.status,200);
  r=await fetch(`${base}/api/admin/data`,{headers:{cookie}});assert.equal(r.status,401,'logout deve invalidar sessão');
 });

test('validação de conteúdo de upload e limites de entrada', async t=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'repapelie-upload-test-'));
  await cp(path.join(project,'src'),path.join(temp,'src'),{recursive:true});await cp(path.join(project,'public'),path.join(temp,'public'),{recursive:true});await mkdir(path.join(temp,'data','uploads'),{recursive:true});
  const port=await freePort();const token='another-test-token-long-enough-123456';const proc=spawn(process.execPath,['src/server.js'],{cwd:temp,env:{...process.env,PORT:String(port),NODE_ENV:'test',ADMIN_INITIAL_SETUP_TOKEN:token},stdio:'ignore'});const base=`http://127.0.0.1:${port}`;t.after(async()=>{proc.kill('SIGTERM');await rm(temp,{recursive:true,force:true})});await waitFor(`${base}/api/public/health`,proc);
  let r=await fetch(`${base}/api/admin/setup`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({setupToken:token,username:'owner',password:'a-very-secure-password-123'})});const cookie=r.headers.get('set-cookie').split(';')[0];assert.equal(r.status,201);
  r=await fetch(`${base}/api/admin/upload`,{method:'POST',headers:{cookie,'content-type':'image/png'},body:Buffer.from('not really a png')});assert.equal(r.status,415);
  r=await fetch(`${base}/api/admin/products`,{method:'POST',headers:{'content-type':'text/plain',cookie},body:'{}'});assert.equal(r.status,415);
});
