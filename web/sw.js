// خدمة العمل (PWA): واجهة المنصة تفتح بسرعة وتشتغل بنت ضعيف.
// القاعدة: لا تخزين لأي طلب للخادم (erp-api / أي POST) — البيانات دائماً حية من الخادم.
// ملفات الواجهة: الشبكة أولاً ثم النسخة المحفوظة (علشان التحديثات توصل فوراً)؛ الخطوط والصور: المحفوظ أولاً.
const VERSION = 'nekaba-v1';
const SHELL = ['/', '/index.html', '/app.css', '/js/app.js', '/js/config.js', '/manifest.webmanifest',
  '/img/logo-union.png', '/img/icon-192.png', '/img/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;                                   // الخادم (POST) دائماً مباشر
  const fonts = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (url.origin !== location.origin && !fonts) return;               // أي مصدر خارجي آخر: بلا تدخل
  if (fonts || url.pathname.startsWith('/img/')) {                    // المحفوظ أولاً
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res; })));
    return;
  }
  e.respondWith(fetch(req).then(res => {                              // الشبكة أولاً
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(hit => hit || caches.match('/index.html'))));
});
