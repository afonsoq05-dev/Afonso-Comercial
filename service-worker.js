const CACHE='afonso-comercial-v11';
const ASSETS=['./','./index.html','./modern-ui.css','./smart-assistant.css','./elite-map.js','./city-search.js','./route-planner.js','./push-config.js','./smart-assistant.js','./central-ligacoes.js','./central-ligacoes.css','./dimensionador.js','./dimensionador.css','./manifest.webmanifest','./icon-192.png','./icon-512.png','./mapa-territorio.jpeg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('afonso-comercial-')&&k!==CACHE).map(k=>caches.delete(k)))),
  self.clients.claim()
])));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;
  if(e.request.mode==='navigate'){
    e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r;}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));
  }else{
    e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return resp;})));
  }
});
self.addEventListener('push',e=>{
  let payload={};
  try{payload=e.data?.json()||{};}catch(error){payload={body:e.data?.text()||'Você tem um retorno comercial para revisar.'};}
  const title=payload.title||'Afonso Comercial';
  const options={
    body:payload.body||'Você tem um retorno comercial para revisar.',
    icon:'./icon-192.png',
    badge:'./icon-192.png',
    tag:payload.tag||'afonso-commercial-reminder',
    renotify:true,
    data:{url:payload.url||'./?agenda=1'}
  };
  e.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const target=new URL(e.notification.data?.url||'./?agenda=1',self.registration.scope).href;
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{
    const existing=windows.find(client=>new URL(client.url).origin===new URL(target).origin);
    if(existing){existing.navigate(target);return existing.focus();}
    return clients.openWindow(target);
  }));
});
