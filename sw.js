// Spiżarnia - service worker.
// Strategia: najpierw sieć (nowa wersja aplikacji dociera od razu), bez sieci kopia z pamięci telefonu.
// Dane użytkownika leżą w localStorage, service worker ich nie dotyka.
// Przy każdej zmianie plików aplikacji podbij numer WERSJA.

const WERSJA = 'spizarnia-v1';
const PLIKI = [
  './',
  'index.html',
  'styl.css',
  'app.js',
  'przepisy.json',
  'manifest.webmanifest',
  'ikony/apple-touch-icon.png',
  'ikony/ikona-192.png',
  'ikony/ikona-512.png'
];

self.addEventListener('install', zdarzenie => {
  zdarzenie.waitUntil(caches.open(WERSJA).then(c => c.addAll(PLIKI)));
  self.skipWaiting();
});

self.addEventListener('activate', zdarzenie => {
  zdarzenie.waitUntil(
    caches.keys()
      .then(klucze => Promise.all(klucze.filter(k => k !== WERSJA).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', zdarzenie => {
  if (zdarzenie.request.method !== 'GET') return;
  zdarzenie.respondWith(
    fetch(zdarzenie.request)
      .then(odp => {
        const kopia = odp.clone();
        caches.open(WERSJA).then(c => c.put(zdarzenie.request, kopia));
        return odp;
      })
      .catch(() => caches.match(zdarzenie.request, { ignoreSearch: true }))
  );
});
