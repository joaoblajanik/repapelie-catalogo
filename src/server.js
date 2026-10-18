import http from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

// Load a local .env without an external dependency; real process environment wins.
try { for (const line of readFileSync(path.resolve(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2'); } } catch {}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const UPLOADS = path.join(DATA, 'uploads');
const DB = path.join(DATA, 'store.json');
const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';
const MAX_BODY = 1_500_000;
const MAX_IMAGE = 4_000_000;
const MAX_QTY = 99;
const MAX_LINES = 40;
const sessions = new Map();
const attempts = new Map();

const seed = () => ({
  settings: { storeName: 'Repapelie', tagline: 'Seu mundo de papel, criatividade e detalhes especiais.', intro: 'Explore o catálogo e monte sua solicitação. A disponibilidade e os valores finais serão confirmados pela nossa equipe.', whatsapp: '', catalogVisible: true, privacyContact: '', pickupInfo: '' },
  categories: [
    { id: 'cat-escolar', name: 'Material escolar', active: true, order: 0 },
    { id: 'cat-cadernos', name: 'Cadernos e blocos', active: true, order: 1 },
    { id: 'cat-personalizados', name: 'Personalizados', active: true, order: 2 },
    { id: 'cat-festas', name: 'Festas e lembrancinhas', active: true, order: 3 },
    { id: 'cat-outros', name: 'Outros produtos', active: true, order: 4 }
  ], products: [], admin: null, audit: []
});
let db;
let saveQueue = Promise.resolve();
async function loadDb() {
  await mkdir(UPLOADS, { recursive: true });
  try { db = JSON.parse(await readFile(DB, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw new Error('Não foi possível ler data/store.json. O arquivo foi preservado; verifique o JSON e restaure um backup antes de iniciar.'); db = seed(); await saveDb(); }
  db.settings ||= seed().settings; db.categories ||= []; db.products ||= []; db.audit ||= [];
}
function saveDb() {
  saveQueue = saveQueue.then(async () => {
    const tmp = `${DB}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
    const { rename } = await import('node:fs/promises');
    await rename(tmp, DB);
  });
  return saveQueue;
}
const json = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }); res.end(JSON.stringify(body));
};
const safeEqual = (a, b) => {
  const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(v => v.trim()).filter(Boolean).map(v => { const i = v.indexOf('='); return [v.slice(0, i), decodeURIComponent(v.slice(i + 1) || '')]; }));
}
function sessionFor(req) { const c = parseCookies(req); const s = sessions.get(c.rp_session); return s && s.expires > Date.now() ? s : null; }
function requireAdmin(req, res) { const s = sessionFor(req); if (!s) { json(res, 401, { error: 'Entre na área administrativa para continuar.' }); return null; } return s; }
function cookieHeader(id, maxAge) { return `rp_session=${encodeURIComponent(id)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${IS_PROD ? '; Secure' : ''}`; }
function audit(action, subject) { db.audit.unshift({ id: crypto.randomUUID(), action, subject: String(subject || '').slice(0, 120), at: new Date().toISOString() }); db.audit = db.audit.slice(0, 100); }
function normalizePhone(v) { return String(v || '').replace(/\D/g, ''); }
function validPhone(v) { const n = normalizePhone(v); return n.length >= 12 && n.length <= 13 && n.startsWith('55'); }
function str(v, max, required = false) { if (typeof v !== 'string') throw Error('Campo de texto inválido.'); const s = v.trim(); if (required && !s) throw Error('Preencha os campos obrigatórios.'); if (s.length > max) throw Error(`O texto deve ter no máximo ${max} caracteres.`); return s; }
function priceMode(v) { if (!['fixed', 'starting', 'quote', 'unavailable'].includes(v)) throw Error('Tipo de preço inválido.'); return v; }
function validateProduct(input, existing = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Dados do produto inválidos.');
  const name = str(input.name, 100, true); const categoryId = str(input.categoryId, 80, true);
  if (!db.categories.some(c => c.id === categoryId && c.active)) throw Error('Escolha uma categoria ativa.');
  const mode = priceMode(input.priceMode || 'quote'); let priceCents = null;
  if (mode === 'fixed' || mode === 'starting') {
    if (typeof input.priceCents !== 'number' || !Number.isSafeInteger(input.priceCents) || input.priceCents < 0 || input.priceCents > 100000000) throw Error('Informe um preço válido em centavos.');
    priceCents = input.priceCents;
  }
  const availability = input.availability || 'available'; if (!['available','unavailable','made-to-order'].includes(availability)) throw Error('Disponibilidade inválida.');
  const options = Array.isArray(input.options) ? input.options.slice(0, 20).map((o, i) => {
    if (!o || typeof o !== 'object') throw Error('Opção de personalização inválida.');
    const label = str(o.label, 60, true); const type = o.type || 'select';
    if (!['select','radio','checkbox','text','textarea','color'].includes(type)) throw Error('Tipo de personalização inválido.');
    const choices = Array.isArray(o.choices) ? o.choices.slice(0, 30).map(x => str(x, 80, true)) : [];
    if (['select','radio','checkbox','color'].includes(type) && choices.length === 0) throw Error(`Adicione opções para “${label}”.`);
    const feeCents = o.feeCents == null || o.feeCents === '' ? 0 : Number(o.feeCents);
    if (!Number.isSafeInteger(feeCents) || feeCents < 0 || feeCents > 10000000) throw Error('Taxa adicional inválida.');
    return { id: String(o.id || `opt-${i}`).slice(0, 60), label, type, choices, required: Boolean(o.required), help: str(o.help || '', 160), maxLength: Math.min(500, Math.max(1, Number(o.maxLength) || 120)), feeCents };
  }) : [];
  const optionIds = options.map(o => o.id); if (new Set(optionIds).size !== optionIds.length) throw Error('Cada opção precisa ter um identificador único.');
  const validImage = value => !value || (/^\/uploads\/[\w-]+\.(?:jpg|png|webp)$/.test(value) && path.basename(value) === value.slice('/uploads/'.length));
  if (!validImage(input.image || '') || (Array.isArray(input.gallery) && input.gallery.some(x => !validImage(x)))) throw Error('Use somente imagens enviadas para esta loja.');
  const sku = str(input.sku || '', 40);
  if (sku && db.products.some(p => p.sku.toLowerCase() === sku.toLowerCase() && p.id !== existing.id)) throw Error('Já existe um produto com essa referência.');
  return { name, sku, categoryId, shortDescription: str(input.shortDescription || '', 180), description: str(input.description || '', 2000), image: str(input.image || '', 180), gallery: Array.isArray(input.gallery) ? input.gallery.slice(0, 8).map(x => str(x,180)) : [], priceMode: mode, priceCents, availability, options, tags: Array.isArray(input.tags) ? input.tags.slice(0, 12).map(x => str(x,30)).filter(Boolean) : [], active: Boolean(input.active), published: Boolean(input.published), updatedAt: new Date().toISOString(), createdAt: existing.createdAt || new Date().toISOString() };
}
async function body(req) {
  let chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw Object.assign(Error('Solicitação muito grande.'), { status: 413 }); chunks.push(chunk); }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  if (!(req.headers['content-type'] || '').includes('application/json')) throw Object.assign(Error('Tipo de conteúdo inválido.'), { status: 415 });
  try { return JSON.parse(raw); } catch { throw Object.assign(Error('JSON inválido.'), { status: 400 }); }
}
function checkOrigin(req) {
  const origin = req.headers.origin;
  const trusted = process.env.TRUSTED_ORIGIN;
  if (trusted && origin && origin !== trusted) return false;
  if (IS_PROD && origin && origin !== `https://${req.headers.host}` && origin !== trusted) return false;
  return true;
}
function publicProduct(p) { return { id:p.id, name:p.name, sku:p.sku, categoryId:p.categoryId, shortDescription:p.shortDescription, description:p.description, image:p.image, gallery:p.gallery, priceMode:p.priceMode, priceCents:p.priceCents, availability:p.availability, options:p.options.map(o=>({id:o.id,label:o.label,type:o.type,choices:o.choices,required:o.required,help:o.help,maxLength:o.maxLength,feeCents:o.feeCents})), tags:p.tags }; }
function safeSetting(v) { return { ...v, whatsapp: validPhone(v.whatsapp) ? normalizePhone(v.whatsapp) : '' }; }
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  if (IS_PROD) res.setHeader('Strict-Transport-Security','max-age=31536000');
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','strict-origin-when-cross-origin'); res.setHeader('X-Frame-Options','DENY'); res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (pathname.startsWith('/api/') && ['POST','PUT','PATCH','DELETE'].includes(req.method) && !checkOrigin(req)) return json(res,403,{error:'Origem não autorizada.'});
  try {
    if (pathname === '/api/public/catalog' && req.method === 'GET') {
      if (!db.settings.catalogVisible) return json(res,404,{error:'O catálogo está temporariamente indisponível.'});
      return json(res,200,{settings:{storeName:db.settings.storeName,tagline:db.settings.tagline,intro:db.settings.intro,whatsappConfigured:validPhone(db.settings.whatsapp),whatsapp:validPhone(db.settings.whatsapp)?normalizePhone(db.settings.whatsapp):'',pickupInfo:db.settings.pickupInfo},categories:db.categories.filter(c=>c.active).sort((a,b)=>a.order-b.order),products:db.products.filter(p=>p.active&&p.published&&p.availability!=='unavailable').map(publicProduct)});
    }
    if (pathname === '/api/public/health' && req.method === 'GET') return json(res,200,{ok:true});
    if (pathname === '/api/admin/status' && req.method === 'GET') return json(res,200,{setupRequired:!db.admin,authenticated:Boolean(sessionFor(req))});
    if (pathname === '/api/admin/setup' && req.method === 'POST') {
      if (db.admin) return json(res,409,{error:'A configuração inicial já foi concluída.'});
      const b = await body(req); const expected = process.env.ADMIN_INITIAL_SETUP_TOKEN || '';
      if (expected.length < 24 || !safeEqual(b.setupToken || '', expected)) return json(res,403,{error:'Token de configuração inválido ou não configurado. Defina ADMIN_INITIAL_SETUP_TOKEN no ambiente.'});
      const username = str(b.username,50,true).toLowerCase(); const password = String(b.password || '');
      if (!/^[a-z0-9._-]{3,50}$/.test(username)) return json(res,400,{error:'Use um usuário com 3 a 50 caracteres: letras, números, ponto, hífen ou sublinhado.'});
      if (password.length < 12 || password.length > 200) return json(res,400,{error:'A senha deve ter entre 12 e 200 caracteres.'});
      const salt = crypto.randomBytes(16); const hash = await new Promise((resolve,reject)=>crypto.scrypt(password,salt,64,(e,k)=>e?reject(e):resolve(k)));
      db.admin = { username, salt:salt.toString('hex'), hash:hash.toString('hex'), createdAt:new Date().toISOString() }; audit('admin_created',username); await saveDb();
      const id=crypto.randomBytes(32).toString('base64url'); sessions.set(id,{username,expires:Date.now()+8*60*60*1000}); return json(res,201,{ok:true},{'Set-Cookie':cookieHeader(id,28800)});
    }
    if (pathname === '/api/admin/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || 'unknown'; const rec=attempts.get(ip)||{count:0,until:0};
      if (rec.until>Date.now()) return json(res,429,{error:'Muitas tentativas. Aguarde alguns minutos e tente novamente.'});
      const b=await body(req); const username=String(b.username||'').toLowerCase(); const password=String(b.password||'');
      let ok=false;
      if (db.admin) { const salt=Buffer.from(db.admin.salt,'hex'); const hash=await new Promise((resolve,reject)=>crypto.scrypt(password,salt,64,(e,k)=>e?reject(e):resolve(k))); ok=safeEqual(username,db.admin.username)&&safeEqual(hash.toString('hex'),db.admin.hash); }
      if (!ok) { rec.count++; if(rec.count>=5){rec.until=Date.now()+5*60*1000;rec.count=0;} attempts.set(ip,rec); return json(res,401,{error:'Não foi possível entrar. Confira os dados e tente novamente.'}); }
      attempts.delete(ip); const id=crypto.randomBytes(32).toString('base64url'); sessions.set(id,{username,expires:Date.now()+8*60*60*1000}); return json(res,200,{ok:true},{'Set-Cookie':cookieHeader(id,28800)});
    }
    if (pathname === '/api/admin/logout' && req.method === 'POST') { const c=parseCookies(req); if(c.rp_session)sessions.delete(c.rp_session); return json(res,200,{ok:true},{'Set-Cookie':cookieHeader('',0)}); }
    if (pathname.startsWith('/api/admin/')) {
      const s=requireAdmin(req,res); if(!s)return;
      if(pathname==='/api/admin/overview'&&req.method==='GET') return json(res,200,{products:db.products.length,active:db.products.filter(p=>p.active&&p.published).length,inactive:db.products.filter(p=>!p.active||!p.published).length,categories:db.categories.length,missingImages:db.products.filter(p=>!p.image).length,priceReview:db.products.filter(p=>p.priceMode==='unavailable'||p.priceMode==='quote').length,lastUpdate:db.products.map(p=>p.updatedAt).sort().at(-1)||null,audit:db.audit.slice(0,10)});
      if(pathname==='/api/admin/data'&&req.method==='GET') return json(res,200,{settings:db.settings,categories:db.categories,products:db.products});
      if(pathname==='/api/admin/settings'&&req.method==='PUT') {
        const b=await body(req); const whatsapp=normalizePhone(b.whatsapp||''); if(whatsapp && !validPhone(whatsapp)) return json(res,400,{error:'Informe o WhatsApp com código do país e DDD (ex.: 5511999999999).'});
        db.settings={storeName:str(b.storeName||'Repapelie',80,true),tagline:str(b.tagline||'',180),intro:str(b.intro||'',500),whatsapp,catalogVisible:Boolean(b.catalogVisible),privacyContact:str(b.privacyContact||'',120),pickupInfo:str(b.pickupInfo||'',300)}; audit('settings_updated','configurações da loja'); await saveDb(); return json(res,200,{ok:true});
      }
      if(pathname==='/api/admin/categories'&&req.method==='POST') { const b=await body(req); const name=str(b.name,60,true); if(db.categories.some(c=>c.name.toLowerCase()===name.toLowerCase()))return json(res,409,{error:'Já existe uma categoria com esse nome.'}); const c={id:crypto.randomUUID(),name,active:true,order:db.categories.length}; db.categories.push(c); audit('category_created',name); await saveDb(); return json(res,201,c); }
      const catMatch=pathname.match(/^\/api\/admin\/categories\/([\w-]+)$/);
      if(catMatch&&req.method==='PUT'){const b=await body(req);const c=db.categories.find(x=>x.id===catMatch[1]);if(!c)return json(res,404,{error:'Categoria não encontrada.'});c.name=str(b.name,60,true);c.active=Boolean(b.active);if(Number.isInteger(b.order))c.order=Math.max(0,Math.min(1000,b.order));audit('category_updated',c.name);await saveDb();return json(res,200,c);}
      if(catMatch&&req.method==='DELETE'){const c=db.categories.find(x=>x.id===catMatch[1]);if(!c)return json(res,404,{error:'Categoria não encontrada.'});if(db.products.some(p=>p.categoryId===c.id))return json(res,409,{error:'Esta categoria possui produtos. Mova os produtos antes de excluir.'});db.categories=db.categories.filter(x=>x.id!==c.id);audit('category_deleted',c.name);await saveDb();return json(res,200,{ok:true});}
      if(pathname==='/api/admin/products'&&req.method==='POST'){const b=await body(req);const p=validateProduct(b);p.id=crypto.randomUUID();db.products.push(p);audit('product_created',p.name);await saveDb();return json(res,201,p);}
      const productMatch=pathname.match(/^\/api\/admin\/products\/([\w-]+)$/);
      if(productMatch&&req.method==='PUT'){const b=await body(req);const i=db.products.findIndex(p=>p.id===productMatch[1]);if(i<0)return json(res,404,{error:'Produto não encontrado.'});const old=db.products[i];db.products[i]={...validateProduct(b,old),id:old.id,createdAt:old.createdAt};audit('product_updated',old.name);await saveDb();return json(res,200,db.products[i]);}
      if(productMatch&&req.method==='DELETE'){const i=db.products.findIndex(p=>p.id===productMatch[1]);if(i<0)return json(res,404,{error:'Produto não encontrado.'});db.products[i].active=false;db.products[i].published=false;audit('product_archived',db.products[i].name);await saveDb();return json(res,200,{ok:true});}
      if(pathname==='/api/admin/upload'&&req.method==='POST'){
        let chunks=[],size=0;for await(const c of req){size+=c.length;if(size>MAX_IMAGE)return json(res,413,{error:'A imagem deve ter até 4 MB.'});chunks.push(c);}const buf=Buffer.concat(chunks);let ext='';
        if(buf.length>3&&buf.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff])))ext='.jpg';else if(buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))ext='.png';else if(buf.length>12&&buf.toString('ascii',0,4)==='RIFF'&&buf.toString('ascii',8,12)==='WEBP')ext='.webp';else return json(res,415,{error:'Formato inválido. Envie uma imagem JPEG, PNG ou WebP válida.'});
        const name=`${crypto.randomUUID()}${ext}`;await writeFile(path.join(UPLOADS,name),buf,{flag:'wx',mode:0o640});return json(res,201,{path:`/uploads/${name}`});
      }
      return json(res,404,{error:'Rota administrativa não encontrada.'});
    }
    if(pathname.startsWith('/uploads/')) {
      const name=path.basename(pathname);if(name!==pathname.slice('/uploads/'.length)||!/^[-\w]+\.(jpg|png|webp)$/.test(name))return json(res,404,{error:'Imagem não encontrada.'});
      try{const f=path.join(UPLOADS,name);const st=await stat(f);if(st.size>MAX_IMAGE)return json(res,404,{error:'Imagem não encontrada.'});const ext=path.extname(name);res.writeHead(200,{'Content-Type':ext==='.jpg'?'image/jpeg':ext==='.png'?'image/png':'image/webp','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'});return res.end(await readFile(f));}catch{return json(res,404,{error:'Imagem não encontrada.'});}
    }
    if(req.method==='GET') {
      const rel=pathname==='/'?'index.html':pathname.slice(1);const file=path.resolve(PUBLIC,rel);if(!file.startsWith(PUBLIC+path.sep))return json(res,404,{error:'Não encontrado.'});
      try{const content=await readFile(file);const ext=path.extname(file);const type=ext==='.html'?'text/html; charset=utf-8':ext==='.css'?'text/css; charset=utf-8':ext==='.js'?'text/javascript; charset=utf-8':ext==='.svg'?'image/svg+xml':'application/octet-stream';res.writeHead(200,{'Content-Type':type,'Cache-Control':ext==='.html'?'no-cache':'public, max-age=3600'});return res.end(content);}catch{return json(res,404,{error:'Página não encontrada.'});}
    }
    return json(res,405,{error:'Método não permitido.'});
  } catch(e) { return json(res,e.status||400,{error:e.status?e.message:(e.message||'Não foi possível concluir a operação.')}); }
}
await loadDb();
const server=http.createServer((req,res)=>{handle(req,res).catch(()=>{if(!res.headersSent)json(res,500,{error:'Ocorreu um erro inesperado. Tente novamente.'});else res.end();});});
server.listen(PORT,'0.0.0.0',()=>console.log(`Repapelie disponível em http://localhost:${PORT}`));
