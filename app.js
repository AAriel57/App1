const ISLAS = {
  todas: [[1.1, 38.6], [4.4, 40.15]],
  Mallorca: [[2.3, 39.25], [3.48, 39.97]],
  Menorca: [[3.78, 39.78], [4.33, 40.1]],
  Eivissa: [[1.15, 38.83], [1.63, 39.13]],
  Formentera: [[1.37, 38.63], [1.6, 38.81]],
};
const COLORES = { guardado: '#c2410c', libre: '#2563eb', albergue: '#7c3aed' };
const TIPO_TEXTO = { guardado: 'Refugio guardado', libre: 'Refugio libre', albergue: 'Albergue' };

const $ = (id) => document.getElementById(id);
const movil = matchMedia('(max-width: 760px)');
let refugios = { type: 'FeatureCollection', features: [] };
let ruta = null; // { nombre, puntos: [{lat, lon, ele, km}] }
let islaActiva = 'todas';
let conectadosActuales = [];
let etapas = []; // [{ n, nombre, puntos, dist, sube, firme: {asfalto, pista, sendero} }]
let etapaActiva = null; // número de etapa, 0 = travesía completa
let pestana = 'rutas';

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

// Textos de los controles del mapa en español (los leen los lectores de pantalla)
const LOCALE = {
  'Map.Title': 'Mapa de refugios y rutas',
  'NavigationControl.ZoomIn': 'Acercar',
  'NavigationControl.ZoomOut': 'Alejar',
  'NavigationControl.ResetBearing': 'Orientar al norte',
  'GeolocateControl.FindMyLocation': 'Mostrar mi ubicación',
  'GeolocateControl.LocationNotAvailable': 'Ubicación no disponible',
  'AttributionControl.ToggleAttribution': 'Mostrar u ocultar créditos',
  'ScaleControl.Kilometers': 'km',
  'ScaleControl.Meters': 'm',
  'Popup.Close': 'Cerrar',
};

const map = new maplibregl.Map({
  container: 'map',
  bounds: ISLAS.todas,
  fitBoundsOptions: { padding: 30 },
  locale: LOCALE,
  cooperativeGestures: false,
});
map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }));

// El estilo se aplica después de escuchar style.load: con un estilo en línea el evento se emite en el
// acto, y no esperamos a 'load' porque espera a todas las teselas (OpenTopoMap puede ir lento).
const mapaListo = new Promise((resolve) => {
  map.once('style.load', () => iniciarMapa().then(resolve, (err) => {
    mostrarError('No se han podido cargar los refugios. Comprueba la conexión y recarga la página.');
    console.error(err);
    resolve();
  }));
  map.setStyle(ESTILO);
});

async function iniciarMapa() {
  // Etapas de la travesía debajo de la ruta seleccionada, que se dibuja encima con la capa 'ruta'
  map.addSource('etapas', { type: 'geojson', data: vacio() });
  map.addLayer({
    id: 'etapas', type: 'line', source: 'etapas',
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: pestana === 'rutas' ? 'visible' : 'none' },
    paint: { 'line-color': '#9f1239', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 13, 5], 'line-opacity': 0.55 },
  });
  map.on('click', 'etapas', (e) => seleccionarEtapa(etapas[e.features[0].properties.etapa - 1]));
  map.on('mouseenter', 'etapas', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'etapas', () => (map.getCanvas().style.cursor = ''));

  map.addSource('ruta', { type: 'geojson', data: vacio() });
  map.addLayer({ id: 'ruta-borde', type: 'line', source: 'ruta', paint: { 'line-color': '#fff', 'line-width': 7 } });
  map.addLayer({ id: 'ruta', type: 'line', source: 'ruta', paint: { 'line-color': '#e11d48', 'line-width': 4 } });

  const r = await fetch('data/refugios.geojson');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  refugios = await r.json();

  map.addSource('refugios', { type: 'geojson', data: refugios });
  map.addLayer({
    id: 'refugios',
    type: 'circle',
    source: 'refugios',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 6, 14, 10],
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
    paint: { 'circle-radius': 15, 'circle-color': 'transparent', 'circle-stroke-color': '#e11d48', 'circle-stroke-width': 3 },
  }, 'refugios');

  map.on('click', 'refugios', (e) => abrirPopup(e.features[0]));
  map.on('mouseenter', 'refugios', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'refugios', () => (map.getCanvas().style.cursor = ''));

  actualizarIsla();
  await cargarEtapas();
}

// ---------- Rutas de Mallorca (etapas de refugio a refugio) ----------
async function cargarEtapas() {
  try {
    const r = await fetch('data/rutas.geojson');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const datos = await r.json();
    map.getSource('etapas').setData(datos);
    etapas = datos.features.map((f) => {
      const p = f.properties;
      const puntos = conKm(f.geometry.coordinates.map(([lon, lat, ele]) => ({ lon, lat, ele: ele ?? null })));
      return { n: p.etapa, nombre: p.nombre, puntos, dist: puntos.at(-1).km, sube: desnivel(puntos).sube, firme: { asfalto: p.asfalto, pista: p.pista, sendero: p.sendero } };
    });
    pintarEtapas();
    if (pestana === 'rutas' && !ruta) encuadrarEtapas();
  } catch (err) {
    console.error(err);
    $('rutasResumen').textContent = 'No se han podido cargar las rutas. Comprueba la conexión y recarga la página.';
  }
}

function conKm(puntos) {
  let km = 0;
  puntos.forEach((p, i) => { if (i) km += distKm(puntos[i - 1], p); p.km = km; });
  return puntos;
}

function pintarEtapas() {
  const total = etapas.reduce((s, e) => s + e.dist, 0);
  const sube = etapas.reduce((s, e) => s + (e.sube ?? 0), 0);
  $('rutasResumen').textContent = `${etapas.length} etapas · ${total.toFixed(0)} km · +${Math.round(sube).toLocaleString('es')} m, de Galatzó a s'Arenalet des Verger por la Serra de Tramuntana`;
  const ol = $('listaEtapas');
  ol.innerHTML = '';
  for (const e of etapas) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.etapa = e.n;
    b.innerHTML = `<span>${esc(e.nombre)}<small>${e.dist.toFixed(1)} km · +${Math.round(e.sube ?? 0)} m · ${textoFirme(e.firme)}</small></span>`;
    b.addEventListener('click', () => seleccionarEtapa(e));
    li.append(b);
    ol.append(li);
  }
  const li = document.createElement('li');
  li.className = 'completa';
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.etapa = 0;
  b.innerHTML = `<span>Travesía completa<small>${total.toFixed(0)} km · las ${etapas.length} etapas seguidas</small></span>`;
  b.addEventListener('click', () => seleccionarEtapa(null));
  li.append(b);
  ol.append(li);
}

const textoFirme = (f) =>
  [['asfalto', 'asfalto'], ['pista', 'pista'], ['sendero', 'sendero']]
    .filter(([k]) => f[k] > 0)
    .map(([k, t]) => `${f[k]} % ${t}`)
    .join(' · ');

// e = null selecciona la travesía completa
function seleccionarEtapa(e) {
  if (!etapas.length) return;
  mostrarError('');
  if (e) {
    etapaActiva = e.n;
    ruta = { nombre: `Etapa ${e.n}: ${e.nombre}`, puntos: e.puntos.map((p) => ({ ...p })), firme: e.firme };
  } else {
    etapaActiva = 0;
    const puntos = conKm(etapas.flatMap((x) => x.puntos.map((p) => ({ ...p }))));
    const firme = {};
    for (const k of ['asfalto', 'pista', 'sendero']) {
      firme[k] = Math.round(etapas.reduce((s, x) => s + x.firme[k] * x.dist, 0) / puntos.at(-1).km);
    }
    ruta = { nombre: 'Travesía completa de Mallorca', puntos, firme };
  }
  marcarEtapa();
  if (movil.matches) abrirPanel(false);
  dibujarRuta();
}

function marcarEtapa() {
  document.querySelectorAll('#listaEtapas button').forEach((b) => {
    if (etapaActiva != null && +b.dataset.etapa === etapaActiva) b.setAttribute('aria-current', 'true');
    else b.removeAttribute('aria-current');
  });
}

function encuadrarEtapas() {
  const coords = etapas.flatMap((e) => e.puntos.map((p) => [p.lon, p.lat]));
  if (!coords.length) return;
  map.fitBounds(coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0])), { padding: margen(40) });
}

// ---------- Pestañas del panel ----------
const pestanas = { rutas: $('tabRutas'), subir: $('tabSubir') };
const vistas = { rutas: $('vistaRutas'), subir: $('vistaSubir') };
function cambiarPestana(nueva, foco = false) {
  pestana = nueva;
  for (const k of Object.keys(pestanas)) {
    const activa = k === nueva;
    pestanas[k].setAttribute('aria-selected', String(activa));
    pestanas[k].tabIndex = activa ? 0 : -1;
    vistas[k].hidden = !activa;
  }
  if (foco) pestanas[nueva].focus();
  if (map.getLayer('etapas')) map.setLayoutProperty('etapas', 'visibility', nueva === 'rutas' ? 'visible' : 'none');
  if (nueva === 'rutas' && !ruta) encuadrarEtapas();
}
for (const [k, b] of Object.entries(pestanas)) {
  b.addEventListener('click', () => cambiarPestana(k));
  // Flechas para moverse entre pestañas (patrón de pestañas de WAI-ARIA)
  b.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    cambiarPestana(k === 'rutas' ? 'subir' : 'rutas', true);
  });
}

// Margen para encuadrar el mapa sin que lo tape el panel inferior en el móvil
function margen(base) {
  if (!movil.matches) return base;
  const panel = $('panel').getBoundingClientRect();
  return { top: base, left: base, right: base, bottom: base + panel.height };
}

// ---------- Panel inferior (móvil) ----------
const panel = $('panel');
const asa = $('asa');
function abrirPanel(abierto) {
  panel.classList.toggle('abierto', abierto);
  asa.setAttribute('aria-expanded', String(abierto));
}
asa.addEventListener('click', () => {
  const abrir = !panel.classList.contains('abierto');
  abrirPanel(abrir);
  if (abrir && ruta) $('ruta').scrollIntoView({ block: 'start' }); // ir directo a los resultados
});
panel.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && movil.matches && panel.classList.contains('abierto')) {
    abrirPanel(false);
    asa.focus();
  }
});
// El enlace "Saltar al panel" también lo despliega en el móvil
document.querySelector('.saltar').addEventListener('click', () => movil.matches && abrirPanel(true));

function actualizarAsa() {
  if (!ruta) return ($('asaTexto').textContent = 'Ver rutas y refugios');
  const n = conectadosActuales.length;
  $('asaTexto').textContent = `${ruta.puntos.at(-1).km.toFixed(1)} km · ${n} refugio${n === 1 ? '' : 's'} cerca · ver detalles`;
}

// ---------- Avisos accesibles ----------
function anunciar(texto) {
  const aviso = $('aviso');
  aviso.textContent = '';
  setTimeout(() => (aviso.textContent = texto), 50);
}
function mostrarError(texto) {
  const el = $('error');
  el.textContent = texto;
  el.hidden = !texto;
  if (texto && movil.matches) abrirPanel(true);
}

// ---------- Islas ----------
const botonesIsla = document.querySelectorAll('.islas button');
botonesIsla.forEach((btn) =>
  btn.addEventListener('click', () => {
    islaActiva = btn.dataset.isla;
    botonesIsla.forEach((b) => {
      b.classList.toggle('activa', b === btn);
      b.setAttribute('aria-pressed', String(b === btn));
    });
    actualizarIsla();
    map.fitBounds(ISLAS[islaActiva], { padding: margen(30) });
    const n = visiblesEnIsla().length;
    anunciar(`${islaActiva === 'todas' ? 'Todas las islas' : islaActiva}: ${n} refugio${n === 1 ? '' : 's'}.`);
  })
);

const visiblesEnIsla = () =>
  refugios.features.filter((f) => islaActiva === 'todas' || f.properties.isla === islaActiva);

function actualizarIsla() {
  if (!map.getLayer('refugios')) return; // iniciarMapa lo llamará cuando el mapa esté listo
  const filtro = islaActiva === 'todas' ? null : ['==', ['get', 'isla'], islaActiva];
  map.setFilter('refugios', filtro);
  const visibles = visiblesEnIsla();
  $('contador').textContent = `(${visibles.length})`;
  $('notaIsla').textContent =
    islaActiva !== 'todas' && !visibles.some((f) => f.properties.tipo !== 'albergue')
      ? `Todavía no hay refugios de montaña registrados en ${islaActiva}. La comunidad podrá añadirlos.`
      : '';
  pintarListaRefugios(visibles);
}

function pintarListaRefugios(visibles) {
  const ul = $('listaRefugios');
  ul.innerHTML = '';
  if (!visibles.length) {
    ul.innerHTML = '<li class="vacio">No hay refugios en esta isla.</li>';
    return;
  }
  [...visibles]
    .sort((a, b) => a.properties.nombre.localeCompare(b.properties.nombre, 'es'))
    .forEach((f) => {
      const p = f.properties;
      ul.append(botonRefugio(f, `${esc(p.nombre)}<small>${TIPO_TEXTO[p.tipo]}${p.altitud ? ` · ${esc(p.altitud)} m` : ''}</small>`, true));
    });
}

function botonRefugio(f, html, conPunto) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  b.innerHTML = `${conPunto ? `<i class="dot ${f.properties.tipo}" aria-hidden="true"></i>` : ''}<span>${html}</span>`;
  b.addEventListener('click', () => irARefugio(f, b));
  li.append(b);
  return li;
}

function irARefugio(f, origen) {
  if (movil.matches) abrirPanel(false);
  map.flyTo({ center: f.geometry.coordinates, zoom: 14, padding: margen(0) });
  abrirPopup(f, origen);
}

let popup = null, alCerrar = null;
function abrirPopup(f, origen) {
  const p = f.properties;
  const filas = [
    `<h4>${esc(p.nombre)}</h4>`,
    `<p>${TIPO_TEXTO[p.tipo]} · ${esc(p.isla)}</p>`,
    p.altitud && `<p>Altitud: ${esc(p.altitud)} m</p>`,
    p.capacidad && `<p>Plazas: ${esc(p.capacidad)}</p>`,
    p.operador && `<p>Gestión: ${esc(p.operador)}</p>`,
    p.telefono && `<p>Tel.: <a href="tel:${esc(p.telefono)}">${esc(p.telefono)}</a></p>`,
    p.web && `<p><a href="${esc(p.web)}" target="_blank" rel="noopener">Web<span class="visualmente-oculto"> de ${esc(p.nombre)} (se abre en otra pestaña)</span></a></p>`,
  ];
  if (popup) { popup.off('close', alCerrar); popup.remove(); }
  popup = new maplibregl.Popup({ offset: 12, maxWidth: '280px', focusAfterOpen: true })
    .setLngLat(f.geometry.coordinates)
    .setHTML(filas.filter(Boolean).join(''))
    .addTo(map);
  // Al cerrar, devolver el foco al botón de la lista desde el que se abrió
  alCerrar = origen ? () => { if (movil.matches) abrirPanel(true); origen.focus(); } : null;
  if (alCerrar) popup.on('close', alCerrar);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && popup?.isOpen()) popup.remove();
});

// ---------- Subida de GPX ----------
const dz = $('dropzone');
$('gpx').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) f.text().then((t) => leerGpx(t, f.name));
  e.target.value = ''; // permite volver a subir el mismo archivo
});
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('sobre'); });
dz.addEventListener('dragleave', () => dz.classList.remove('sobre'));
dz.addEventListener('drop', (e) => {
  e.preventDefault();
  dz.classList.remove('sobre');
  const f = e.dataTransfer.files[0];
  if (f) f.text().then((t) => leerGpx(t, f.name));
});
$('ejemplo').addEventListener('click', async () => {
  try {
    const r = await fetch('data/ejemplo-prueba.gpx');
    if (!r.ok) throw new Error();
    leerGpx(await r.text(), 'ejemplo-prueba.gpx');
  } catch {
    mostrarError('No se ha podido cargar la ruta de ejemplo.');
  }
});
$('radio').addEventListener('input', () => {
  const v = $('radio').value;
  $('radioValor').textContent = v;
  $('radio').setAttribute('aria-valuetext', `${v} kilómetros`);
  if (ruta) mostrarConectados(true);
});
$('quitarRuta').addEventListener('click', quitarRuta);

async function leerGpx(texto, nombreArchivo) {
  mostrarError('');
  const xml = new DOMParser().parseFromString(texto, 'application/xml');
  if (xml.querySelector('parsererror')) {
    return mostrarError(`«${nombreArchivo}» no es un archivo GPX válido. Expórtalo de nuevo desde tu aplicación (formato .gpx).`);
  }
  // parseFloat y no +: un atributo ausente (null) daría 0, una coordenada válida
  const puntos = [...xml.querySelectorAll('trkpt, rtept')].map((n) => ({
    lat: parseFloat(n.getAttribute('lat')),
    lon: parseFloat(n.getAttribute('lon')),
    ele: n.querySelector('ele') ? +n.querySelector('ele').textContent : null,
  })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (puntos.length < 2) {
    return mostrarError(`«${nombreArchivo}» no contiene ningún track. Asegúrate de exportar la ruta, no solo los puntos de interés.`);
  }

  conKm(puntos);

  const nombre = xml.querySelector('trk > name, rte > name, metadata > name')?.textContent.trim() || nombreArchivo.replace(/\.gpx$/i, '');
  ruta = { nombre, puntos };
  etapaActiva = null;
  marcarEtapa();
  await mapaListo;
  if (movil.matches) abrirPanel(false); // dejar ver la ruta en el mapa; el resumen queda en el asa
  dibujarRuta();
}

function dibujarRuta() {
  const coords = ruta.puntos.map((p) => [p.lon, p.lat]);
  map.getSource('ruta').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} });
  const b = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
  map.fitBounds(b, { padding: margen(50) });

  const { sube, baja, max } = desnivel(ruta.puntos);
  const dist = ruta.puntos.at(-1).km;
  $('ruta').hidden = false;
  $('rutaNombre').textContent = ruta.nombre;
  $('statDist').textContent = `${dist.toFixed(1)} km`;
  $('statUp').textContent = sube == null ? '–' : `${Math.round(sube)} m`;
  $('statDown').textContent = baja == null ? '–' : `${Math.round(baja)} m`;
  $('statMax').textContent = max == null ? '–' : `${Math.round(max)} m`;
  $('firme').hidden = !ruta.firme;
  $('firme').textContent = ruta.firme ? `Firme: ${textoFirme(ruta.firme)}` : '';
  dibujarPerfil();
  mostrarConectados();

  const n = conectadosActuales.length;
  anunciar(
    `Ruta «${ruta.nombre}» cargada: ${dist.toFixed(1)} kilómetros` +
      (sube != null ? `, ${Math.round(sube)} metros de desnivel positivo` : '') +
      `. ${n ? `${n} refugio${n === 1 ? '' : 's'} a menos de ${$('radio').value} km.` : 'Ningún refugio cerca.'}`
  );
}

function quitarRuta() {
  ruta = null;
  conectadosActuales = [];
  etapaActiva = null;
  marcarEtapa();
  map.getSource('ruta')?.setData(vacio());
  if (map.getLayer('refugios-conectados')) map.setFilter('refugios-conectados', ['in', ['get', 'id'], ['literal', []]]);
  $('ruta').hidden = true;
  actualizarAsa();
  if (pestana === 'rutas') encuadrarEtapas();
  else map.fitBounds(ISLAS[islaActiva], { padding: margen(30) });
  anunciar('Ruta quitada.');
  (pestana === 'rutas' ? $('tabRutas') : $('gpx')).focus();
}

$('descargarGpx').addEventListener('click', () => {
  const pts = ruta.puntos
    .map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}">${p.ele != null ? `<ele>${p.ele}</ele>` : ''}</trkpt>`)
    .join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Rutas y Refugios Illes Balears" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>${esc(ruta.nombre)}</name><trkseg>
${pts}
</trkseg></trk>
</gpx>
`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  a.download = `${ruta.nombre.normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'ruta'}.gpx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

function desnivel(puntos) {
  const eles = puntos.map((p) => p.ele).filter((e) => e != null && Number.isFinite(e));
  if (eles.length < 2) return {};
  // Histéresis de 3 m para no sumar el ruido del GPS
  let sube = 0, baja = 0, ref = eles[0];
  for (const e of eles) {
    if (e - ref >= 3) { sube += e - ref; ref = e; }
    else if (ref - e >= 3) { baja += ref - e; ref = e; }
  }
  return { sube, baja, max: Math.max(...eles), min: Math.min(...eles) };
}

function dibujarPerfil() {
  const pts = ruta.puntos.filter((p) => p.ele != null && Number.isFinite(p.ele));
  const svg = $('perfil');
  if (pts.length < 2) {
    svg.setAttribute('aria-label', 'Perfil de altimetría no disponible: el track no tiene datos de altitud.');
    return (svg.innerHTML = '');
  }
  const total = ruta.puntos.at(-1).km || 1;
  const min = Math.min(...pts.map((p) => p.ele));
  const max = Math.max(...pts.map((p) => p.ele));
  const y = (e) => 76 - ((e - min) / (max - min || 1)) * 70;
  const linea = pts.map((p, i) => `${i ? 'L' : 'M'}${((p.km / total) * 300).toFixed(1)},${y(p.ele).toFixed(1)}`).join('');
  svg.innerHTML = `<path class="area" d="${linea}L300,80L0,80Z"/><path class="linea" d="${linea}"/>`;
  svg.setAttribute('aria-label', `Perfil de altimetría: entre ${Math.round(min)} y ${Math.round(max)} metros, empieza a ${Math.round(pts[0].ele)} m y termina a ${Math.round(pts.at(-1).ele)} m.`);
}

function mostrarConectados(anunciarCambio = false) {
  const radio = +$('radio').value;
  conectadosActuales = refugios.features
    .map((f) => ({ f, ...cercania(f.geometry.coordinates, ruta.puntos) }))
    .filter((c) => c.dist <= radio)
    .sort((a, b) => a.km - b.km);

  map.setFilter('refugios-conectados', ['in', ['get', 'id'], ['literal', conectadosActuales.map((c) => c.f.properties.id)]]);
  const ol = $('conectados');
  ol.innerHTML = conectadosActuales.length
    ? ''
    : `<li class="vacio">Ningún refugio a menos de ${radio} km. Prueba a ampliar la distancia.</li>`;
  for (const c of conectadosActuales) {
    const lejos = c.dist < 0.1 ? 'a pie de ruta' : `a ${(c.dist * 1000).toFixed(0)} m`;
    ol.append(botonRefugio(c.f, `${esc(c.f.properties.nombre)}<small>km ${c.km.toFixed(1)} de la ruta · ${lejos} · ${TIPO_TEXTO[c.f.properties.tipo]}</small>`));
  }
  actualizarAsa();
  if (anunciarCambio) {
    clearTimeout(mostrarConectados.t);
    const n = conectadosActuales.length;
    mostrarConectados.t = setTimeout(() => anunciar(`${n} refugio${n === 1 ? '' : 's'} a menos de ${radio} km.`), 400);
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
