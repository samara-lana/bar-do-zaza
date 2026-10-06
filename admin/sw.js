/**
 * Faz o admin abrir mesmo sem internet (celular reiniciado no bar sem sinal,
 * por exemplo) e permite instalar como app no Android.
 *
 * Arquivos do próprio site: tenta a rede primeiro (pra pegar versão nova) e,
 * se a rede falhar ou demorar mais de 3 s, usa a cópia guardada. As chamadas
 * ao Supabase (outro endereço) não passam por aqui: quem cuida delas é o app,
 * com as comandas salvas no celular.
 */
var CACHE = "zaza-admin-v1";
var ARQUIVOS = [
  "./",
  "index.html",
  "admin.css",
  "admin.js",
  "comandas.js",
  "manifest.webmanifest",
  "../assets/config.js",
  "../assets/style.css",
  "../assets/favicon.svg",
  "../assets/icone-192.png",
  "../assets/icone-512.png",
];
var ESPERA_MS = 3000;

self.addEventListener("install", function (ev) {
  ev.waitUntil(
    caches
      .open(CACHE)
      .then(function (c) {
        return c.addAll(ARQUIVOS);
      })
      .then(function () {
        return self.skipWaiting();
      }),
  );
});

self.addEventListener("activate", function (ev) {
  ev.waitUntil(
    caches
      .keys()
      .then(function (nomes) {
        return Promise.all(
          nomes
            .filter(function (n) {
              return n !== CACHE;
            })
            .map(function (n) {
              return caches.delete(n);
            }),
        );
      })
      .then(function () {
        return self.clients.claim();
      }),
  );
});

self.addEventListener("fetch", function (ev) {
  var req = ev.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  ev.respondWith(
    new Promise(function (resolve) {
      var respondeu = false;
      var usarCopia = function () {
        caches.match(req, { ignoreSearch: true }).then(function (copia) {
          if (copia && !respondeu) {
            respondeu = true;
            resolve(copia);
          }
        });
      };
      var timer = setTimeout(usarCopia, ESPERA_MS);
      fetch(req)
        .then(function (resp) {
          clearTimeout(timer);
          if (resp.ok) {
            var copia = resp.clone();
            caches.open(CACHE).then(function (c) {
              c.put(req, copia);
            });
          }
          if (!respondeu) {
            respondeu = true;
            resolve(resp);
          }
        })
        .catch(function () {
          clearTimeout(timer);
          caches.match(req, { ignoreSearch: true }).then(function (copia) {
            if (respondeu) return;
            respondeu = true;
            resolve(copia || Response.error());
          });
        });
    }),
  );
});
