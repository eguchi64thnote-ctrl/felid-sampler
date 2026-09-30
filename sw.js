const CACHE='felid-generator-v11-range-scale-fix-export-defaults';
const ASSETS=['./','./index.html','./styles.css','./app.js',
'./chunks/app-00.txt','./chunks/app-01.txt','./chunks/app-02.txt','./chunks/app-03.txt','./chunks/app-04.txt','./chunks/app-05.txt','./chunks/app-06.txt','./chunks/app-07.txt','./chunks/app-08.txt',
'./samples/track01.mp3','./samples/track02.mp3','./samples/track03.mp3','./samples/track04.mp3','./samples/track05.mp3','./samples/track06.mp3','./samples/track07.mp3','./samples/track08.mp3','./samples/track09.mp3',
'./samples/in-track01.mp3','./samples/in-track02.mp3','./samples/in-track03.mp3','./samples/in-track04.mp3','./samples/in-track05.mp3','./samples/in-track06.mp3','./samples/in-track07.mp3','./samples/in-track08.mp3','./samples/in-track09.mp3','./samples/in-track10.mp3',
'./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return resp}).catch(()=>caches.match('./index.html'))))});