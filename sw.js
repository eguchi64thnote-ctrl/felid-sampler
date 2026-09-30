const CACHE='felid-magic-hour-v11';
const ASSETS=['./','./index.html',
  './samples/track01.mp3',
  './samples/track02.mp3',
  './samples/track03.mp3',
  './samples/track04.mp3',
  './samples/track05.mp3',
  './samples/track06.mp3',
  './samples/track07.mp3',
  './samples/track08.mp3',
  './samples/track09.mp3','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return resp}).catch(()=>caches.match('./index.html'))))});