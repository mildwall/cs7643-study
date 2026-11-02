// Serves the encrypted site. Once the access code has been entered, this worker decrypts each file on request.
const BASE = new URL('./', self.location).pathname;
const DB = 'cs7643-gate';
let key;
let manifest;

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storedKey() {
  const store = (await db()).transaction('kv').objectStore('kv');
  return new Promise((resolve) => {
    const req = store.get('key');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

async function forget() {
  key = undefined;
  manifest = undefined;
  (await db()).transaction('kv', 'readwrite').objectStore('kv').delete('key');
}

async function open(name) {
  const res = await fetch(`${BASE}vault/${name}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`missing ${name}`);
  const data = new Uint8Array(await res.arrayBuffer());
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, key, data.slice(12));
}

async function loadManifest() {
  key ??= await storedKey();
  if (!key) return undefined;
  try {
    manifest = JSON.parse(new TextDecoder().decode(await open('manifest.bin')));
    return manifest;
  } catch {
    // The site was republished with a new code, so the saved key no longer works.
    await forget();
    return undefined;
  }
}

async function serve(request, path) {
  const fresh = request.mode === 'navigate' || !manifest;
  const map = fresh ? await loadManifest() : manifest;
  const entry = map?.[path];
  if (!entry) return fetch(request);
  try {
    return new Response(await open(entry[0]), { headers: { 'Content-Type': entry[1] } });
  } catch {
    // A deploy replaced the file ids while this page was open. Read the new list once and retry.
    const again = (await loadManifest())?.[path];
    if (!again) return fetch(request);
    return new Response(await open(again[0]), { headers: { 'Content-Type': again[1] } });
  }
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('message', (event) => {
  if (event.data === 'lock') event.waitUntil(forget());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  let path = decodeURIComponent(url.pathname.slice(BASE.length));
  if (path === 'sw.js' || path.startsWith('vault/')) return;
  if (path === '' || path.endsWith('/')) path += 'index.html';
  event.respondWith(serve(event.request, path));
});
