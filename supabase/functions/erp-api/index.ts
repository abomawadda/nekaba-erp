// خادم منصة النقابة: POST {action, payload, token} ← JSON
// المنطق كله في Postgres (api.handle) داخل transaction واحدة. هنا فقط: التوقيع، حد المحاولات، الضغط.
import postgres from 'npm:postgres@3.4.5';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const DIRECT = Deno.env.get('SUPABASE_DB_URL')!;
const POOLER_HOST = 'aws-0-eu-central-1.pooler.supabase.com';
let sql: any;
try {
  const u = new URL(DIRECT);
  const ref = (u.hostname.match(/^db\.([a-z0-9]+)\./) || [])[1] || (u.username.split('.')[1] || '');
  if (!ref) throw new Error('no ref');
  sql = postgres(`postgres://postgres.${ref}:${encodeURIComponent(decodeURIComponent(u.password))}@${POOLER_HOST}:6543/postgres`,
    { max: 3, prepare: false, idle_timeout: 10, connect_timeout: 15 });
} catch (_) { sql = postgres(DIRECT, { max: 2, prepare: false, idle_timeout: 10, connect_timeout: 10 }); }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const gz = promisify(gzip);
async function reply(obj: unknown, status = 200, acceptGzip = false) {
  const body = JSON.stringify(obj);
  const h: Record<string, string> = { ...CORS, 'Content-Type': 'application/json; charset=utf-8' };
  if (acceptGzip && body.length > 2048) {
    h['Content-Encoding'] = 'gzip';
    return new Response(await gz(Buffer.from(body)), { status, headers: h });
  }
  return new Response(body, { status, headers: h });
}

// ── الجلسات: رمز موقّع HMAC بمفتاح في core.secrets ──
let secretP: Promise<string> | null = null;
const secret = () => (secretP ||= sql`select value from core.secrets where key = 'session_secret'`.then((r: any) => r[0].value));
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const sign = async (b: string) => createHmac('sha256', await secret()).update(b).digest('base64url');
async function issue(session: any) {
  const ttl = session.kind === 'staff' ? 12 * 3600 : 180 * 24 * 3600;   // العضو تبقى جلسته على جهازه
  const body = b64(JSON.stringify({ s: session, exp: Math.floor(Date.now() / 1000) + ttl }));
  return body + '.' + await sign(body);
}
async function verify(token: string) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const good = Buffer.from(await sign(body)), got = Buffer.from(sig);
  if (good.length !== got.length || !timingSafeEqual(good, got)) return null;
  const t = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  return t.exp > Date.now() / 1000 ? t.s : null;
}

// ── حد محاولات الدخول (5 خطأ ⇒ قفل 15 دقيقة) ──
const LOCKED = { success: false, message: 'تم إيقاف الدخول مؤقتاً بسبب تكرار المحاولات الخاطئة. حاول بعد 15 دقيقة.' };
async function isLocked(k: string) {
  const [r] = await sql`select locked_until from core.auth_fails where k = ${k}`;
  return !!(r && r.locked_until && new Date(r.locked_until) > new Date());
}
const fail = (k: string) => sql`insert into core.auth_fails as f (k, fails, updated_at) values (${k}, 1, now())
  on conflict (k) do update set
    fails = case when f.updated_at < now() - interval '15 minutes' then 1 else f.fails + 1 end,
    locked_until = case when (case when f.updated_at < now() - interval '15 minutes' then 1 else f.fails + 1 end) >= 5
                        then now() + interval '15 minutes' else f.locked_until end, updated_at = now()`;
const clear = (k: string) => sql`delete from core.auth_fails where k = ${k}`;

const run = (action: string, payload: unknown, session: unknown) =>
  sql.begin(async (tx: any) => (await tx`select api.handle(${action}, ${tx.json(payload ?? {})}, ${session ? tx.json(session) : null}) as r`)[0].r);

async function handle(action: string, payload: any, token: string, ip: string) {
  if (action === 'LOGIN_MEMBER' || action === 'LOGIN_ADMIN') {
    const k = action === 'LOGIN_ADMIN' ? 'ADM:' + String(payload?.username || '').toLowerCase().trim()
                                       : 'MEM:' + String(payload?.jobId || '').trim();
    if (await isLocked(k) || await isLocked('IP:' + ip)) return LOCKED;
    const res = await run(action, payload, null);
    if (res.success) { await clear(k); res.token = await issue(res.session); delete res.session; }
    else { await fail(k); await fail('IP:' + ip).catch(() => {}); }
    return res;
  }
  const session = await verify(token);
  if (!session) return { success: false, expired: true, message: 'انتهت الجلسة. سجّل الدخول مرة أخرى.' };
  return await run(action, payload, session);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply({ success: true, service: 'nekaba-erp', version: '1.0' });
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'x';
  let body: any;
  try { body = JSON.parse(await req.text()); } catch { return reply({ success: false, message: 'طلب غير صالح.' }, 400); }
  if (!body || typeof body.action !== 'string' || body.action.length > 64) return reply({ success: false, message: 'طلب غير صالح.' }, 400);
  const busy = (e: any) => e && (['53300', '57P03', '40001', '40P01'].includes(e.code) || /too many clients|CONNECT_TIMEOUT/i.test(String(e.message)));
  try {
    for (let i = 0; ; i++) {
      try { return await reply(await handle(body.action, body.payload, body.token, ip), 200, /\bgzip\b/.test(req.headers.get('accept-encoding') || '')); }
      catch (e) { if (!busy(e) || i >= 6) throw e; await new Promise(r => setTimeout(r, Math.min(4000, 150 * 2 ** i))); }
    }
  } catch (err) {
    console.error(body.action, err);
    return reply({ success: false, message: 'حدث خطأ في الخادم. حاول مرة أخرى.' });
  }
});
