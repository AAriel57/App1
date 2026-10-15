const ISLAS = {
  todas: [[1.1, 38.6], [4.4, 40.15]],
  Mallorca: [[2.3, 39.25], [3.48, 39.97]],
  Menorca: [[3.78, 39.78], [4.33, 40.1]],
  Eivissa: [[1.15, 38.83], [1.63, 39.13]],
};
const COLORES = { guardado: '#c2410c', libre: '#2563eb', albergue: '#7c3aed' };
const TIPO_TEXTO = { guardado: 'Refugio guardado', libre: 'Refugio libre', albergue: 'Albergue' };

const $ = (id) => document.getElementById(id);
let refugios = { type: 'FeatureCollection', features: [] };
let ruta = null; // { nombre, puntos: [{lat, lon, ele, km}] }
let islaActiva = 'todas';

const ESTILO = {
  version: 8,
  sources: {
    topo: {
      type: 'raster',
      tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
      tileSize: 256,
      maxzoom: 17,
      attribution: 'Mapa © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · Datos © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [{ id: 'topo', type: 'raster', source: 'topo' }],
};

const map = new maplibregl.Map({
  container: 'map',
  bounds: ISLAS.todas,
  fitBoundsOptions: { padding: 30 },
});
map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }));

// El estilo se aplica después de escuchar style.load: con un estilo en línea el evento se emite en el
// acto, y no esperamos a 'load' porque espera a todas las teselas (OpenTopoMap puede ir lento).
const mapaListo = new Promise((resolve) => {
  map.once('style.load', () => iniciarMapa().then(resolve));
  map.setStyle(ESTILO);
});

async function iniciarMapa() {
  refugios = await fetch('data/refugios.geojson').then((r) => r.json());

  map.addSource('ruta', { type: 'geojson', data: vacio() });
  map.addLayer({ id: 'ruta-borde', type: 'line', source: 'ruta', paint: { 'line-color': '#fff', 'line-width': 7 } });
  map.addLayer({ id: 'ruta', type: 'line', source: 'ruta', paint: { 'line-color': '#e11d48', 'line-width': 4 } });

  map.addSource('refugios', { type: 'geojson', data: refugios });
  map.addLayer({
    id: 'refugios',
    type: 'circle',
    source: 'refugios',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 14, 9],
      'circle-color': ['match', ['get', 'tipo'], 'guardado', COLORES.guardado, 'albergue', COLORES.albergue, COLORES.libre],
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: 'refugios-conectados',
    type: 'circle',
    source: 'refugios',
    filter: ['in', ['get', 'id'], ['literal', []]],
    paint: { 'circle-radius': 14, 'circle-color': 'transparent', 'circle-stroke-color': '#e11d48', 'circle-stroke-width': 3 },
  }, 'refugios');

  map.on('click', 'refugios', (e) => abrirPopup(e.features[0]));
  map.on('mouseenter', 'refugios', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'refugios', () => (map.getCanvas().style.cursor = ''));

  actualizarIsla();
}

// ---------- Islas ----------
document.querySelectorAll('.islas button').forEach((btn) =>
  btn.addEventListener('click', () => {
    islaActiva = btn.dataset.isla;
    document.querySelectorAll('.islas button').forEach((b) => b.classList.toggle('activa', b === btn));
    actualizarIsla();
    map.fitBounds(ISLAS[islaActiva], { padding: 30 });
  })
);

function actualizarIsla() {
  const filtro = islaActiva === 'todas' ? null : ['==', ['get', 'isla'], islaActiva];
  map.setFilter('refugios', filtro);
  const visibles = refugios.features.filter((f) => islaActiva === 'todas' || f.properties.isla === islaActiva);
  $('contador').textContent = `(${visibles.length})`;
  $('notaIsla').textContent =
    islaActiva !== 'todas' && !visibles.some((f) => f.properties.tipo !== 'albergue')
      ? `Todavía no hay refugios de montaña registrados en ${islaActiva}. La comunidad podrá añadirlos.`
      : '';
}

function abrirPopup(f) {
  const p = f.properties;
  const filas = [
    `<h4>${esc(p.nombre)}</h4>`,
    `<p>${TIPO_TEXTO[p.tipo]} · ${esc(p.isla)}</p>`,
    p.altitud && `<p>Altitud: ${esc(p.altitud)} m</p>`,
    p.capacidad && `<p>Plazas: ${esc(p.capacidad)}</p>`,
    p.operador && `<p>Gestión: ${esc(p.operador)}</p>`,
    p.telefono && `<p>Tel.: <a href="tel:${esc(p.telefono)}">${esc(p.telefono)}</a></p>`,
    p.web && `<p><a href="${esc(p.web)}" target="_blank" rel="noopener">Web</a></p>`,
  ];
  new maplibregl.Popup({ offset: 10 }).setLngLat(f.geometry.coordinates).setHTML(filas.filter(Boolean).join('')).addTo(map);
}

// ---------- Subida de GPX ----------
const dz = $('dropzone');
$('gpx').addEventListener('change', (e) => e.target.files[0] && leerGpx(e.target.files[0]));
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('sobre'); });
dz.addEventListener('dragleave', () => dz.classList.remove('sobre'));
dz.addEventListener('drop', (e) => {
  e.preventDefault();
  dz.classList.remove('sobre');
  if (e.dataTransfer.files[0]) leerGpx(e.dataTransfer.files[0]);
});
$('radio').addEventListener('input', () => {
  $('radioValor').textContent = $('radio').value;
  if (ruta) mostrarConectados();
});

async function leerGpx(file) {
  const xml = new DOMParser().parseFromString(await file.text(), 'application/xml');
  const nodos = [...xml.querySelectorAll('trkpt, rtept')];
  if (nodos.length < 2) return alert('El archivo no contiene un track GPX válido.');

  let km = 0;
  const puntos = nodos.map((n) => ({
    lat: +n.getAttribute('lat'),
    lon: +n.getAttribute('lon'),
    ele: n.querySelector('ele') ? +n.querySelector('ele').textContent : null,
  }));
  puntos.forEach((p, i) => { if (i) km += distKm(puntos[i - 1], p); p.km = km; });

  const nombre = xml.querySelector('trk > name, rte > name, metadata > name')?.textContent || file.name.replace(/\.gpx$/i, '');
  ruta = { nombre, puntos };
  await mapaListo;
  dibujarRuta();
}

function dibujarRuta() {
  const coords = ruta.puntos.map((p) => [p.lon, p.lat]);
  map.getSource('ruta').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} });
  const b = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
  map.fitBounds(b, { padding: 50 });

  const { sube, baja, max } = desnivel(ruta.puntos);
  $('ruta').hidden = false;
  $('rutaNombre').textContent = ruta.nombre;
  $('statDist').textContent = `${ruta.puntos.at(-1).km.toFixed(1)} km`;
  $('statUp').textContent = sube == null ? '–' : `${Math.round(sube)} m`;
  $('statDown').textContent = baja == null ? '–' : `${Math.round(baja)} m`;
  $('statMax').textContent = max == null ? '–' : `${Math.round(max)} m`;
  dibujarPerfil();
  mostrarConectados();
}

function desnivel(puntos) {
  const eles = puntos.map((p) => p.ele).filter((e) => e != null);
  if (eles.length < 2) return {};
  // Histéresis de 3 m para no sumar el ruido del GPS
  let sube = 0, baja = 0, ref = eles[0];
  for (const e of eles) {
    if (e - ref >= 3) { sube += e - ref; ref = e; }
    else if (ref - e >= 3) { baja += ref - e; ref = e; }
  }
  return { sube, baja, max: Math.max(...eles) };
}

function dibujarPerfil() {
  const pts = ruta.puntos.filter((p) => p.ele != null);
  const svg = $('perfil');
  if (pts.length < 2) return (svg.innerHTML = '');
  const total = ruta.puntos.at(-1).km;
  const min = Math.min(...pts.map((p) => p.ele));
  const max = Math.max(...pts.map((p) => p.ele));
  const y = (e) => 76 - ((e - min) / (max - min || 1)) * 70;
  const linea = pts.map((p, i) => `${i ? 'L' : 'M'}${((p.km / total) * 300).toFixed(1)},${y(p.ele).toFixed(1)}`).join('');
  svg.innerHTML = `<path class="area" d="${linea}L300,80L0,80Z"/><path class="linea" d="${linea}"/>`;
}

function mostrarConectados() {
  const radio = +$('radio').value;
  const conectados = refugios.features
    .map((f) => ({ f, ...cercania(f.geometry.coordinates, ruta.puntos) }))
    .filter((c) => c.dist <= radio)
    .sort((a, b) => a.km - b.km);

  map.setFilter('refugios-conectados', ['in', ['get', 'id'], ['literal', conectados.map((c) => c.f.properties.id)]]);
  const ol = $('conectados');
  ol.innerHTML = conectados.length
    ? ''
    : `<li class="vacio">Ningún refugio a menos de ${radio} km. Prueba a ampliar la distancia.</li>`;
  for (const c of conectados) {
    const li = document.createElement('li');
    li.innerHTML = `${esc(c.f.properties.nombre)}<small>km ${c.km.toFixed(1)} de la ruta · a ${
      c.dist < 0.1 ? 'pie de ruta' : `${(c.dist * 1000).toFixed(0)} m`
    } · ${TIPO_TEXTO[c.f.properties.tipo]}</small>`;
    li.addEventListener('click', () => {
      map.flyTo({ center: c.f.geometry.coordinates, zoom: 14 });
      abrirPopup(c.f);
    });
    ol.append(li);
  }
}

// ---------- Geometría ----------
function distKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Distancia mínima de un punto [lon, lat] a la polilínea, y km de ruta en ese punto.
function cercania([lon, lat], puntos) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57;
  let mejor = { dist: Infinity, km: 0 };
  for (let i = 1; i < puntos.length; i++) {
    const a = puntos[i - 1], b = puntos[i];
    const ax = (a.lon - lon) * kx, ay = (a.lat - lat) * ky;
    const dx = (b.lon - a.lon) * kx, dy = (b.lat - a.lat) * ky;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const dist = Math.hypot(ax + t * dx, ay + t * dy);
    if (dist < mejor.dist) mejor = { dist, km: a.km + t * (b.km - a.km) };
  }
  return mejor;
}

const vacio = () => ({ type: 'FeatureCollection', features: [] });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
