const ISLAS = {
  todas: [[1.1, 38.6], [4.4, 40.15]],
  Mallorca: [[2.3, 39.25], [3.48, 39.97]],
  Menorca: [[3.78, 39.78], [4.33, 40.1]],
  Eivissa: [[1.15, 38.83], [1.63, 39.13]],
  Formentera: [[1.37, 38.63], [1.6, 38.81]],
};
// Los colores del mapa salen de los tokens de styles.css para no duplicarlos
const css = getComputedStyle(document.documentElement);
const color = (nombre) => css.getPropertyValue(`--${nombre}`).trim();
const COLORES = { guardado: color('guardado'), libre: color('libre'), albergue: color('albergue'), ruta: color('ruta'), etapas: color('etapas'), tinta: color('tinta') };
const TIPO_TEXTO = { guardado: 'Refugio guardado', libre: 'Refugio libre', albergue: 'Albergue' };
const ISLAS_CON_TRAVESIAS = ['todas', 'Mallorca'];

// Números en formato español: 28,5 km
const nf1 = new Intl.NumberFormat('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('es', { maximumFractionDigits: 0 });
const fKm = (x) => `${nf1.format(x)} km`;
const fM = (x) => `${nf0.format(Math.round(x))} m`;
const plural = (n, s) => `${n} ${s}${n === 1 ? '' : 's'}`;

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
  // La pestaña inicial es la de travesías: empezar ya en Mallorca evita un salto desde todo el Mediterráneo
  bounds: ISLAS.Mallorca,
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
  // Trazo opaco con borde blanco: se tiene que leer sobre el relieve también a pleno sol
  const visibilidad = etapasVisibles() ? 'visible' : 'none';
  const ancho = (a, b) => ['interpolate', ['linear'], ['zoom'], 8, a, 13, b];
  map.addLayer({
    id: 'etapas-borde', type: 'line', source: 'etapas',
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: visibilidad },
    paint: { 'line-color': '#fff', 'line-width': ancho(5, 8), 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'etapas', type: 'line', source: 'etapas',
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: visibilidad },
    paint: { 'line-color': COLORES.etapas, 'line-width': ancho(2.5, 4.5) },
  });
  map.on('click', 'etapas', (e) => seleccionarEtapa(etapas[e.features[0].properties.etapa - 1]));
  map.on('mouseenter', 'etapas', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'etapas', () => (map.getCanvas().style.cursor = ''));

  map.addSource('ruta', { type: 'geojson', data: vacio() });
  map.addLayer({ id: 'ruta-borde', type: 'line', source: 'ruta', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 9 } });
  map.addLayer({ id: 'ruta', type: 'line', source: 'ruta', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': COLORES.ruta, 'line-width': 5 } });

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
      'circle-stroke-color': COLORES.tinta,
      'circle-stroke-width': 2,
    },
  });
  // Anillo de tinta (no rojo) para que no se confunda con el trazo de la ruta
  map.addLayer({
    id: 'refugios-conectados',
    type: 'circle',
    source: 'refugios',
    filter: ['in', ['get', 'id'], ['literal', []]],
    paint: { 'circle-radius': 16, 'circle-color': '#ffffffcc', 'circle-stroke-color': COLORES.tinta, 'circle-stroke-width': 3 },
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
    actualizarVistaRutas();
    if (etapasVisibles() && !ruta) encuadrarEtapas();
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
  $('rutasResumen').textContent = `Mallorca · ${etapas.length} etapas · ${nf0.format(total)} km · +${fM(sube)}, de Galatzó a s'Arenalet des Verger por la Serra de Tramuntana.`;
  const ol = $('listaEtapas');
  ol.innerHTML = '';
  for (const e of etapas) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.etapa = e.n;
    b.innerHTML = `<span>${esc(e.nombre)}<small>${fKm(e.dist)} · +${fM(e.sube ?? 0)}</small>${barraFirme(e.firme)}<span class="visualmente-oculto">. Firme: ${textoFirme(e.firme)}</span></span>`;
    b.addEventListener('click', () => seleccionarEtapa(e));
    li.append(b);
    ol.append(li);
  }
  const li = document.createElement('li');
  li.className = 'completa';
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.etapa = 0;
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="17" r="2"/><circle cx="19" cy="7" r="2"/><path d="M7 17h6a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h6"/></svg><span>Travesía completa<small>${nf0.format(total)} km · las ${etapas.length} etapas seguidas</small></span>`;
  b.addEventListener('click', () => seleccionarEtapa(null));
  li.append(b);
  ol.append(li);
}

const TIPOS_FIRME = ['asfalto', 'pista', 'sendero'];

// Reparte el redondeo para que los porcentajes sumen siempre 100
function firme100(f) {
  const r = Object.fromEntries(TIPOS_FIRME.map((k) => [k, Math.max(0, Math.round(f[k] ?? 0))]));
  const dif = 100 - TIPOS_FIRME.reduce((s, k) => s + r[k], 0);
  if (dif) {
    const mayor = TIPOS_FIRME.reduce((a, b) => (r[b] > r[a] ? b : a));
    r[mayor] += dif;
  }
  return r;
}

const textoFirme = (f) => {
  const r = firme100(f);
  return TIPOS_FIRME.filter((k) => r[k] > 0).map((k) => `${r[k]} % ${k}`).join(' · ');
};

const barraFirme = (f) => {
  const r = firme100(f);
  return `<span class="barra-firme" aria-hidden="true">${TIPOS_FIRME.filter((k) => r[k] > 0).map((k) => `<i class="${k}" style="flex: ${r[k]}"></i>`).join('')}</span>`;
};

function pintarFirme(f) {
  const r = firme100(f);
  $('firme').innerHTML =
    `<span class="visualmente-oculto">Firme: ${textoFirme(f)}</span>${barraFirme(f)}` +
    `<ul aria-hidden="true">${TIPOS_FIRME.filter((k) => r[k] > 0).map((k) => `<li><i class="muestra ${k}"></i><b>${r[k]} %</b> ${k}</li>`).join('')}</ul>`;
}

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
  enfocarRuta();
}

// En escritorio el detalle queda a la vista y recibe el foco; en el móvil el panel está plegado y manda el mapa
function enfocarRuta() {
  if (movil.matches) return;
  $('panel').scrollTo({ top: 0 });
  $('rutaNombre').focus({ preventScroll: true });
}

function etapasVisibles() {
  return pestana === 'rutas' && ISLAS_CON_TRAVESIAS.includes(islaActiva);
}

// La pestaña de travesías respeta el filtro de isla: fuera de Mallorca muestra un estado vacío honesto
function actualizarVistaRutas() {
  const hay = ISLAS_CON_TRAVESIAS.includes(islaActiva);
  $('listaEtapas').hidden = !hay;
  $('rutasResumen').hidden = !hay;
  $('sinTravesias').hidden = hay;
  if (!hay) $('sinTravesiasTexto').textContent = `Aún no hay travesías en ${islaActiva}. De momento solo hay etapas de refugio a refugio en Mallorca.`;
  const vis = etapasVisibles() ? 'visible' : 'none';
  for (const id of ['etapas-borde', 'etapas']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
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
  actualizarVistaRutas();
  if (etapasVisibles() && !ruta) encuadrarEtapas();
}
for (const [k, b] of Object.entries(pestanas)) {
  b.addEventListener('click', () => cambiarPestana(k));
  // Flechas, Inicio y Fin para moverse entre pestañas (patrón de pestañas de WAI-ARIA)
  b.addEventListener('keydown', (e) => {
    const destino = { ArrowLeft: k === 'rutas' ? 'subir' : 'rutas', ArrowRight: k === 'rutas' ? 'subir' : 'rutas', Home: 'rutas', End: 'subir' }[e.key];
    if (!destino) return;
    e.preventDefault();
    cambiarPestana(destino, true);
  });
}
$('verMallorca').addEventListener('click', () => document.querySelector('.islas [data-isla="Mallorca"]').click());

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
  actualizarAsa();
}
asa.addEventListener('click', () => {
  const abrir = !panel.classList.contains('abierto');
  abrirPanel(abrir);
  // Ir directo a los resultados desplazando solo el contenido, para que el asa siga a la vista
  if (abrir && ruta) {
    panel.scrollTop = 0;
    $('panelContenido').scrollTop = $('ruta').offsetTop - $('panelContenido').offsetTop;
  }
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
  const texto = $('asaTexto');
  if (panel.classList.contains('abierto')) return (texto.textContent = 'Ver el mapa');
  if (!ruta) return (texto.textContent = 'Ver rutas y refugios');
  const nombre = etapaActiva > 0 ? `Etapa ${etapaActiva}` : etapaActiva === 0 ? 'Travesía completa' : ruta.nombre;
  texto.textContent = `${nombre} · ${fKm(ruta.puntos.at(-1).km)} · ${plural(conectadosActuales.length, 'refugio')} cerca`;
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
    // Una etapa de Mallorca no tiene sentido con el mapa en otra isla: se quita para no mostrar datos cruzados
    if (etapaActiva != null && !ISLAS_CON_TRAVESIAS.includes(islaActiva)) quitarRuta({ encuadrar: false, foco: false });
    actualizarIsla();
    actualizarVistaRutas();
    map.fitBounds(ISLAS[islaActiva], { padding: margen(30) });
    const n = visiblesEnIsla().length;
    anunciar(`${islaActiva === 'todas' ? 'Todas las islas' : islaActiva}: ${plural(n, 'refugio')}.`);
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
      ul.append(botonRefugio(f, `${esc(p.nombre)}<small>${TIPO_TEXTO[p.tipo]}${p.altitud ? ` · altitud ${esc(p.altitud)} m` : ''}</small>`, true));
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
  const enRuta = ruta && conectadosActuales.find((c) => c.f.properties.id === p.id);
  const filas = [
    `<h4>${esc(p.nombre)}</h4>`,
    `<p>${TIPO_TEXTO[p.tipo]} · ${esc(p.isla)}</p>`,
    enRuta && `<p class="en-ruta">En el km ${nf1.format(enRuta.km)} de la ruta · ${textoDesvio(enRuta.dist)}</p>`,
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
  const v = String(+$('radio').value).replace('.', ',');
  $('radioValor').textContent = v;
  $('radio').setAttribute('aria-valuetext', `${v} kilómetros`);
  if (ruta) mostrarConectados(true);
});
$('quitarRuta').addEventListener('click', () => quitarRuta());
$('centrarRuta').addEventListener('click', () => {
  if (movil.matches) abrirPanel(false);
  encuadrarRuta();
});

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
  enfocarRuta();
}

function encuadrarRuta() {
  const coords = ruta.puntos.map((p) => [p.lon, p.lat]);
  map.fitBounds(coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0])), { padding: margen(50) });
}

function dibujarRuta() {
  const coords = ruta.puntos.map((p) => [p.lon, p.lat]);
  map.getSource('ruta').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} });
  encuadrarRuta();

  const { sube, baja, max } = desnivel(ruta.puntos);
  const dist = ruta.puntos.at(-1).km;
  $('ruta').hidden = false;
  $('rutaNombre').textContent = ruta.nombre;
  $('statDist').textContent = fKm(dist);
  $('statUp').textContent = sube == null ? '–' : fM(sube);
  $('statDown').textContent = baja == null ? '–' : fM(baja);
  $('statMax').textContent = max == null ? '–' : fM(max);
  $('firme').hidden = !ruta.firme;
  if (ruta.firme) pintarFirme(ruta.firme);
  else $('firme').innerHTML = '';
  dibujarPerfil();
  mostrarConectados();

  const n = conectadosActuales.length;
  anunciar(
    `Ruta «${ruta.nombre}» cargada: ${nf1.format(dist)} kilómetros` +
      (sube != null ? `, ${nf0.format(Math.round(sube))} metros de desnivel positivo` : '') +
      `. ${n ? `${plural(n, 'refugio')} a menos de ${$('radioValor').textContent} km.` : 'Ningún refugio cerca.'}`
  );
}

function quitarRuta({ encuadrar = true, foco = true } = {}) {
  ruta = null;
  conectadosActuales = [];
  etapaActiva = null;
  marcarEtapa();
  map.getSource('ruta')?.setData(vacio());
  if (map.getLayer('refugios-conectados')) map.setFilter('refugios-conectados', ['in', ['get', 'id'], ['literal', []]]);
  $('ruta').hidden = true;
  actualizarAsa();
  if (encuadrar) {
    if (etapasVisibles()) encuadrarEtapas();
    else map.fitBounds(ISLAS[islaActiva], { padding: margen(30) });
  }
  anunciar('Ruta quitada.');
  if (foco) (pestana === 'rutas' ? $('tabRutas') : $('gpx')).focus();
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
  const total = ruta.puntos.at(-1).km || 1;
  $('perfilKm').textContent = fKm(total);
  if (pts.length < 2) {
    svg.setAttribute('aria-label', 'Perfil de altimetría no disponible: el track no tiene datos de altitud.');
    $('perfilMax').textContent = $('perfilMin').textContent = '';
    return (svg.innerHTML = '');
  }
  const min = Math.min(...pts.map((p) => p.ele));
  const max = Math.max(...pts.map((p) => p.ele));
  // Margen arriba y abajo para que las cotas no pisen la línea
  const y = (e) => 74 - ((e - min) / (max - min || 1)) * 54;
  const linea = pts.map((p, i) => `${i ? 'L' : 'M'}${((p.km / total) * 300).toFixed(1)},${y(p.ele).toFixed(1)}`).join('');
  svg.innerHTML = `<path class="area" d="${linea}L300,80L0,80Z"/><path class="linea" d="${linea}"/><g id="perfilMarcas"></g>`;
  $('perfilMax').textContent = fM(max);
  $('perfilMin').textContent = fM(min);
  svg.setAttribute('aria-label', `Perfil de altimetría: entre ${fM(min)} y ${fM(max)}, empieza a ${fM(pts[0].ele)} y termina a ${fM(pts.at(-1).ele)}.`);
}

// Líneas discontinuas en el perfil donde quedan los refugios conectados
function marcarRefugiosEnPerfil() {
  const g = document.getElementById('perfilMarcas');
  if (!g) return;
  const total = ruta.puntos.at(-1).km || 1;
  g.innerHTML = conectadosActuales
    .map((c) => { const x = ((c.km / total) * 300).toFixed(1); return `<line class="marca-refugio" x1="${x}" x2="${x}" y1="0" y2="80"/>`; })
    .join('');
}

function textoDesvio(dist) {
  if (dist < 0.1) return 'a pie de ruta';
  if (dist < 1) return `a ${nf0.format(Math.round(dist * 100) * 10)} m del trazado`;
  return `a ${fKm(dist)} del trazado`;
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
    : `<li class="vacio">Ningún refugio a menos de ${$('radioValor').textContent} km. Prueba a ampliar la distancia.</li>`;
  for (const c of conectadosActuales) {
    ol.append(botonRefugio(c.f, `${esc(c.f.properties.nombre)}<small>En el km ${nf1.format(c.km)} · ${textoDesvio(c.dist)} · ${TIPO_TEXTO[c.f.properties.tipo]}</small>`, true));
  }
  marcarRefugiosEnPerfil();
  actualizarAsa();
  if (anunciarCambio) {
    clearTimeout(mostrarConectados.t);
    const n = conectadosActuales.length;
    mostrarConectados.t = setTimeout(() => anunciar(`${plural(n, 'refugio')} a menos de ${$('radioValor').textContent} km.`), 400);
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
