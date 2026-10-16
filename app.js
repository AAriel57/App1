// MapLibre servido desde el propio sitio (vendor/), sin depender de un CDN: copia verificada contra la
// integridad del paquete de npm. Para actualizarlo, sustituir la carpeta y cambiar la versión aquí y en index.html.
import * as maplibregl from './vendor/maplibre-gl-6.11.2/maplibre-gl.mjs';
import { t, idioma, IDIOMAS, guardarIdioma, traducirDocumento } from './i18n.js';

traducirDocumento();

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
const TIPO_TEXTO = { guardado: t('tipoGuardado'), libre: t('tipoLibre'), albergue: t('tipoAlbergue') };
const ISLAS_CON_TRAVESIAS = ['todas', 'Mallorca'];
const nombreIsla = (isla) => (isla === 'todas' ? t('todasLasIslas') : isla);

// Números en el formato del idioma: 28,5 km (es, ca, de) o 28.5 km (en)
const nf1 = new Intl.NumberFormat(idioma, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat(idioma, { maximumFractionDigits: 0 });
const fKm = (x) => `${nf1.format(x)} km`;
const fM = (x) => `${nf0.format(Math.round(x))} m`;
// Recuentos con su plural: t('nRefugios', { n }) → «1 refugio», «3 refugios»
const contar = (clave, n) => t(clave, { n });

const $ = (id) => document.getElementById(id);
const movil = matchMedia('(max-width: 760px)');
let refugios = { type: 'FeatureCollection', features: [] };
let ruta = null; // { nombre, puntos: [{lat, lon, ele, km}] }
let islaActiva = 'todas';
let conectadosActuales = [];
let etapas = []; // [{ n, nombre, puntos, dist, sube, firme: {asfalto, pista, sendero} }]
let etapaActiva = null; // número de etapa, 0 = travesía completa
let pestana = 'rutas';

// Estado compartible en la URL: #isla=Mallorca&etapa=3&radio=2.5&mapa=bici&mtb=1
const hashInicial = new URLSearchParams(location.hash.slice(1));
let capaBase = hashInicial.get('mapa') === 'bici' ? 'bici' : 'topo';
let capaMtb = hashInicial.get('mtb') === '1';
// Object.hasOwn y no ISLAS[x]: «constructor» o «toString» también existen en cualquier objeto
const esIsla = (x) => typeof x === 'string' && Object.hasOwn(ISLAS, x);
const islaInicial = esIsla(hashInicial.get('isla')) && hashInicial.get('isla') !== 'todas' ? hashInicial.get('isla') : 'Mallorca';

const OSM = `${t('creditoDatos')} © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>`;
const visible = (si) => ({ visibility: si ? 'visible' : 'none' });
const ESTILO = {
  version: 8,
  sources: {
    topo: {
      type: 'raster',
      tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
      tileSize: 256,
      maxzoom: 17,
      attribution: `${t('creditoMapa')} © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · ${OSM}`,
    },
    bici: {
      type: 'raster',
      tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png`),
      tileSize: 256,
      maxzoom: 20,
      attribution: `${t('creditoMapa')} <a href="https://www.cyclosm.org">CyclOSM</a> · ${OSM}`,
    },
    mtb: {
      type: 'raster',
      tiles: ['https://tile.waymarkedtrails.org/mtb/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 18,
      attribution: `${t('creditoMtb')} © <a href="https://mtb.waymarkedtrails.org">Waymarked Trails</a> (CC-BY-SA)`,
    },
  },
  layers: [
    { id: 'topo', type: 'raster', source: 'topo', layout: visible(capaBase === 'topo') },
    { id: 'bici', type: 'raster', source: 'bici', layout: visible(capaBase === 'bici') },
    { id: 'mtb', type: 'raster', source: 'mtb', layout: visible(capaMtb), paint: { 'raster-opacity': 0.9 } },
  ],
};

// Textos de los controles del mapa en el idioma elegido (los leen los lectores de pantalla)
const LOCALE = {
  'Map.Title': t('mapaAria'),
  'NavigationControl.ZoomIn': t('mapaAcercar'),
  'NavigationControl.ZoomOut': t('mapaAlejar'),
  'NavigationControl.ResetBearing': t('mapaNorte'),
  'GeolocateControl.FindMyLocation': t('mapaUbicacion'),
  'GeolocateControl.LocationNotAvailable': t('mapaSinUbicacion'),
  'AttributionControl.ToggleAttribution': t('mapaCreditos'),
  'ScaleControl.Kilometers': 'km',
  'ScaleControl.Meters': 'm',
  'Popup.Close': t('cerrar'),
};

const map = new maplibregl.Map({
  container: 'map',
  // La pestaña inicial es la de travesías: empezar ya en Mallorca evita un salto desde todo el Mediterráneo
  bounds: ISLAS[islaInicial],
  fitBoundsOptions: { padding: 30 },
  locale: LOCALE,
  cooperativeGestures: false,
});

// Selector de capas: mapa base (topográfico o ciclista) y rutas MTB señalizadas encima
class ControlCapas {
  onAdd() {
    const el = document.createElement('details');
    el.className = 'maplibregl-ctrl maplibregl-ctrl-group capas';
    el.innerHTML = `
      <summary aria-label="${t('capas')}" title="${t('capas')}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/></svg>
      </summary>
      <div class="capas-menu">
        <fieldset>
          <legend>${t('capaBase')}</legend>
          <label><input type="radio" name="capaBase" value="topo"> ${t('capaTopo')}</label>
          <label><input type="radio" name="capaBase" value="bici"> ${t('capaBici')}</label>
        </fieldset>
        <label class="capas-mtb"><input type="checkbox" name="capaMtb"> ${t('capaMtb')}</label>
      </div>`;
    el.addEventListener('change', (e) => {
      if (e.target.name === 'capaBase') capaBase = e.target.value;
      if (e.target.name === 'capaMtb') capaMtb = e.target.checked;
      aplicarCapas();
      escribirHash();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.open) { el.open = false; el.querySelector('summary').focus(); }
    });
    this.el = el;
    sincronizarControlCapas();
    return el;
  }
  onRemove() { this.el.remove(); }
}
const controlCapas = new ControlCapas();
function sincronizarControlCapas() {
  const el = controlCapas.el;
  if (!el) return;
  el.querySelectorAll('[name="capaBase"]').forEach((i) => (i.checked = i.value === capaBase));
  el.querySelector('[name="capaMtb"]').checked = capaMtb;
}
function aplicarCapas() {
  sincronizarControlCapas();
  if (!map.getLayer('topo')) return;
  map.setLayoutProperty('topo', 'visibility', capaBase === 'topo' ? 'visible' : 'none');
  map.setLayoutProperty('bici', 'visibility', capaBase === 'bici' ? 'visible' : 'none');
  map.setLayoutProperty('mtb', 'visibility', capaMtb ? 'visible' : 'none');
}

map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), 'top-right');
map.addControl(controlCapas, 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }));

// El estilo se aplica después de escuchar style.load: con un estilo en línea el evento se emite en el
// acto, y no esperamos a 'load' porque espera a todas las teselas (OpenTopoMap puede ir lento).
const mapaListo = new Promise((resolve) => {
  map.once('style.load', () => iniciarMapa().then(resolve, (err) => {
    mostrarError(t('errorRefugios'));
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
  map.addLayer({ id: 'ruta', type: 'line', source: 'ruta', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['coalesce', ['get', 'c'], COLORES.ruta], 'line-width': 5 } });

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

  // Punto que sigue al cursor del perfil de altimetría
  map.addSource('cursor', { type: 'geojson', data: vacio() });
  map.addLayer({
    id: 'cursor', type: 'circle', source: 'cursor',
    paint: { 'circle-radius': 7, 'circle-color': COLORES.ruta, 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 },
  });
  // Y al revés: pasar el ratón por la ruta mueve el cursor del perfil
  map.on('mousemove', 'ruta-borde', (e) => ruta && mostrarCursor(cercania([e.lngLat.lng, e.lngLat.lat], ruta.puntos).km));
  map.on('mouseleave', 'ruta-borde', ocultarCursor);

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
      const dist = puntos.at(-1).km;
      // Los tramos vienen en metros de BRouter; se reescalan a los km calculados aquí para que encajen con los puntos
      const metros = p.tramos?.at(-1)?.[0] || 1;
      const tramos = (p.tramos || []).map(([m, letra]) => ({ hasta: (m / metros) * dist, tipo: { a: 'asfalto', p: 'pista', s: 'sendero' }[letra] }));
      return { n: p.etapa, nombre: p.nombre, puntos, dist, sube: desnivel(puntos).sube, firme: { asfalto: p.asfalto, pista: p.pista, sendero: p.sendero }, tramos };
    });
    pintarEtapas();
    actualizarVistaRutas();
    if (etapaPendiente != null) aplicarEtapaDelHash();
    else if (etapasVisibles() && !ruta) encuadrarEtapas();
  } catch (err) {
    console.error(err);
    $('rutasResumen').textContent = t('errorRutas');
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
  $('rutasResumen').textContent = t('resumenTravesia', { etapas: contar('nEtapas', etapas.length), km: nf0.format(total), sube: fM(sube) });
  const ol = $('listaEtapas');
  ol.innerHTML = '';
  for (const e of etapas) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.etapa = e.n;
    b.innerHTML = `<span>${esc(e.nombre)}<small>${fKm(e.dist)} · +${fM(e.sube ?? 0)}</small>${barraFirme(e.firme)}<span class="visualmente-oculto">. ${t('firme')}: ${textoFirme(e.firme)}</span></span>`;
    aplicarAnchosFirme(b);
    b.addEventListener('click', () => seleccionarEtapa(e));
    li.append(b);
    ol.append(li);
  }
  const li = document.createElement('li');
  li.className = 'completa';
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.etapa = 0;
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="17" r="2"/><circle cx="19" cy="7" r="2"/><path d="M7 17h6a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h6"/></svg><span>${t('travesiaCompleta')}<small>${nf0.format(total)} km · ${t('etapasSeguidas', { n: etapas.length })}</small></span>`;
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
  return TIPOS_FIRME.filter((k) => r[k] > 0).map((k) => `${r[k]} % ${t(k)}`).join(' · ');
};

const barraFirme = (f) => {
  const r = firme100(f);
  return `<span class="barra-firme" aria-hidden="true">${TIPOS_FIRME.filter((k) => r[k] > 0).map((k) => `<i class="${k}" data-p="${r[k]}"></i>`).join('')}</span>`;
};

// Los anchos se aplican con el CSSOM y no con style="…": la CSP no permite estilos en línea
function aplicarAnchosFirme(contenedor) {
  contenedor.querySelectorAll('.barra-firme [data-p]').forEach((i) => (i.style.flexGrow = i.dataset.p));
}

function pintarFirme(f) {
  const r = firme100(f);
  $('firme').innerHTML =
    `<span class="visualmente-oculto">${t('firme')}: ${textoFirme(f)}</span>${barraFirme(f)}` +
    `<ul aria-hidden="true">${TIPOS_FIRME.filter((k) => r[k] > 0).map((k) => `<li><i class="muestra ${k}"></i><b>${r[k]} %</b> ${t(k)}</li>`).join('')}</ul>`;
  aplicarAnchosFirme($('firme'));
}

// e = null selecciona la travesía completa
function seleccionarEtapa(e, { foco = true } = {}) {
  if (!etapas.length) return;
  mostrarError('');
  if (e) {
    etapaActiva = e.n;
    ruta = { nombre: `${t('etapaN', { n: e.n })}: ${e.nombre}`, puntos: e.puntos.map((p) => ({ ...p })), firme: e.firme, tramos: e.tramos };
  } else {
    etapaActiva = 0;
    const puntos = conKm(etapas.flatMap((x) => x.puntos.map((p) => ({ ...p }))));
    const firme = {};
    for (const k of ['asfalto', 'pista', 'sendero']) {
      firme[k] = Math.round(etapas.reduce((s, x) => s + x.firme[k] * x.dist, 0) / puntos.at(-1).km);
    }
    // Tramos de todas las etapas seguidas, desplazados por los km acumulados
    let base = 0;
    const tramos = etapas.flatMap((x) => {
      const t = x.tramos.map((tr) => ({ hasta: base + tr.hasta, tipo: tr.tipo }));
      base += x.dist;
      return t;
    });
    ruta = { nombre: t('travesiaCompletaMallorca'), puntos, firme, tramos };
  }
  marcarEtapa();
  if (movil.matches) abrirPanel(false);
  dibujarRuta();
  if (foco) enfocarRuta();
  escribirHash();
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
  if (!hay) $('sinTravesiasTexto').textContent = t('sinTravesias', { isla: islaActiva });
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
  escribirHash();
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
  if (panel.classList.contains('abierto')) return (texto.textContent = t('verMapa'));
  if (!ruta) return (texto.textContent = t('asaVer'));
  const nombre = etapaActiva > 0 ? t('etapaN', { n: etapaActiva }) : etapaActiva === 0 ? t('travesiaCompleta') : ruta.nombre;
  texto.textContent = `${nombre} · ${fKm(ruta.puntos.at(-1).km)} · ${t('nRefugiosCerca', { n: conectadosActuales.length })}`;
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
function elegirIsla(isla, { encuadrar = true, avisar = true } = {}) {
  islaActiva = isla;
  botonesIsla.forEach((b) => {
    b.classList.toggle('activa', b.dataset.isla === isla);
    b.setAttribute('aria-pressed', String(b.dataset.isla === isla));
  });
  // Una etapa de Mallorca no tiene sentido con el mapa en otra isla: se quita para no mostrar datos cruzados
  if (etapaActiva != null && !ISLAS_CON_TRAVESIAS.includes(islaActiva)) quitarRuta({ encuadrar: false, foco: false });
  actualizarIsla();
  actualizarVistaRutas();
  if (encuadrar) map.fitBounds(ISLAS[islaActiva], { padding: margen(30) });
  if (avisar) {
    const n = visiblesEnIsla().length;
    anunciar(`${nombreIsla(islaActiva)}: ${contar('nRefugios', n)}.`);
  }
  escribirHash();
}
botonesIsla.forEach((btn) => btn.addEventListener('click', () => elegirIsla(btn.dataset.isla)));

// ---------- Enlaces compartibles: el estado vive en la URL ----------
let etapaPendiente = null; // etapa pedida en la URL antes de que carguen las etapas
let aplicandoHash = false;

function escribirHash() {
  if (aplicandoHash) return;
  const p = new URLSearchParams();
  if (islaActiva !== 'todas') p.set('isla', islaActiva);
  if (pestana === 'subir') p.set('vista', 'subir');
  if (etapaActiva != null) p.set('etapa', etapaActiva === 0 ? 'completa' : etapaActiva);
  else if (ruta?.idLocal) p.set('mia', ruta.idLocal);
  if ($('radio').value !== '2') p.set('radio', $('radio').value);
  if (capaBase === 'bici') p.set('mapa', 'bici');
  if (capaMtb) p.set('mtb', '1');
  if (colorRuta !== 'ninguno') p.set('color', colorRuta);
  if ($('diaKm').value !== '60') p.set('dkm', $('diaKm').value);
  if ($('diaSube').value !== '1500') p.set('dsube', $('diaSube').value);
  const s = p.toString();
  history.replaceState(null, '', s ? `#${s}` : location.pathname + location.search);
}

function aplicarHash(p) {
  aplicandoHash = true;
  const isla = esIsla(p.get('isla')) ? p.get('isla') : 'todas';
  if (isla !== islaActiva) elegirIsla(isla, { encuadrar: !p.has('etapa'), avisar: false });
  const vista = p.get('vista') === 'subir' ? 'subir' : 'rutas';
  if (vista !== pestana) cambiarPestana(vista);
  const radio = Number(p.get('radio'));
  ponerRadio(radio >= 0.5 && radio <= 10 ? String(Math.round(radio * 2) / 2) : '2');
  capaBase = p.get('mapa') === 'bici' ? 'bici' : 'topo';
  capaMtb = p.get('mtb') === '1';
  aplicarCapas();
  ponerColorRuta(['pendiente', 'firme'].includes(p.get('color')) ? p.get('color') : 'ninguno');
  ponerLimitesDia(p.get('dkm'), p.get('dsube'));
  const etapa = p.get('etapa');
  etapaPendiente = etapa === 'completa' ? 0 : Number(etapa) || null;
  if (etapa == null && etapaActiva != null) quitarRuta({ foco: false });
  const mia = Number(p.get('mia'));
  aplicandoHash = false;
  if (etapa == null && mia && mia !== ruta?.idLocal) abrirRutaLocal(mia, { foco: false });
  if (etapaPendiente != null && etapas.length) aplicarEtapaDelHash();
}

function aplicarEtapaDelHash() {
  const n = etapaPendiente;
  etapaPendiente = null;
  if (!ISLAS_CON_TRAVESIAS.includes(islaActiva)) return;
  if (n === 0) seleccionarEtapa(null, { foco: false });
  else if (etapas[n - 1]) seleccionarEtapa(etapas[n - 1], { foco: false });
}

window.addEventListener('hashchange', () => aplicarHash(new URLSearchParams(location.hash.slice(1))));

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
      ? t('sinRefugiosIsla', { isla: islaActiva })
      : '';
  pintarListaRefugios(visibles);
}

function pintarListaRefugios(visibles) {
  const ul = $('listaRefugios');
  ul.innerHTML = '';
  if (!visibles.length) {
    ul.innerHTML = `<li class="vacio">${t('noHayRefugios')}</li>`;
    return;
  }
  [...visibles]
    .sort((a, b) => a.properties.nombre.localeCompare(b.properties.nombre, 'es'))
    .forEach((f) => {
      const p = f.properties;
      ul.append(botonRefugio(f, `${esc(p.nombre)}<small>${TIPO_TEXTO[p.tipo]}${p.altitud ? ` · ${t('altitud').toLowerCase()} ${esc(p.altitud)} m` : ''}</small>`, true));
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
    enRuta && `<p class="en-ruta">${t('enElKmDeLaRuta', { km: nf1.format(enRuta.km) })} · ${textoDesvio(enRuta.dist)}</p>`,
    p.altitud && `<p>${t('altitud')}: ${esc(p.altitud)} m</p>`,
    p.capacidad && `<p>${t('plazas')}: ${esc(p.capacidad)}</p>`,
    p.operador && `<p>${t('gestion')}: ${esc(p.operador)}</p>`,
    p.telefono && `<p>${t('telefono')}: <a href="tel:${esc(p.telefono)}">${esc(p.telefono)}</a></p>`,
    urlSegura(p.web) && `<p><a href="${esc(urlSegura(p.web))}" target="_blank" rel="noopener noreferrer">Web<span class="visualmente-oculto"> ${esc(t('webDe', { nombre: p.nombre }))}</span></a></p>`,
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
  if (f) abrirArchivoGpx(f);
  e.target.value = ''; // permite volver a subir el mismo archivo
});
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('sobre'); });
dz.addEventListener('dragleave', () => dz.classList.remove('sobre'));
dz.addEventListener('drop', (e) => {
  e.preventDefault();
  dz.classList.remove('sobre');
  const f = e.dataTransfer.files[0];
  if (f) abrirArchivoGpx(f);
});

// Límites para que un archivo enorme no congele la pestaña (un GPX de varios días ronda los 5-10 MB)
const GPX_MAX_MB = 25;
const GPX_MAX_PUNTOS = 300000;
function abrirArchivoGpx(f) {
  if (f.size > GPX_MAX_MB * 1024 * 1024) {
    return mostrarError(t('errorGpxGrande', { archivo: f.name, mb: nf1.format(f.size / 1024 / 1024), max: GPX_MAX_MB }));
  }
  f.text().then((texto) => leerGpx(texto, f.name), () => mostrarError(t('errorLeer', { archivo: f.name })));
}
$('ejemplo').addEventListener('click', async () => {
  try {
    const r = await fetch('data/ejemplo-prueba.gpx');
    if (!r.ok) throw new Error();
    leerGpx(await r.text(), 'ejemplo-prueba.gpx', { guardar: false }); // el ejemplo no se guarda en el dispositivo
  } catch {
    mostrarError(t('errorEjemplo'));
  }
});
function ponerRadio(valor, anunciarCambio = false) {
  $('radio').value = valor;
  const v = nf0.format(+$('radio').value) === String(+$('radio').value) ? String(+$('radio').value) : nf1.format(+$('radio').value);
  $('radioValor').textContent = v;
  $('radio').setAttribute('aria-valuetext', t('kmAria', { n: v }));
  if (ruta) mostrarConectados(anunciarCambio);
}
$('radio').addEventListener('input', () => {
  ponerRadio($('radio').value, true);
  escribirHash();
});
$('quitarRuta').addEventListener('click', () => quitarRuta());
$('centrarRuta').addEventListener('click', () => {
  if (movil.matches) abrirPanel(false);
  encuadrarRuta();
});

// Compartir la etapa: hoja nativa del móvil o, si no la hay, copiar el enlace
$('compartirRuta').addEventListener('click', async () => {
  const boton = $('compartirRuta');
  const url = location.href;
  try {
    if (navigator.share) {
      await navigator.share({ title: `${ruta.nombre} · ${t('titulo')}`, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    boton.querySelector('span').textContent = t('enlaceCopiado');
    anunciar(t('enlaceCopiadoAviso'));
    clearTimeout(boton.t);
    boton.t = setTimeout(() => (boton.querySelector('span').textContent = t('compartir')), 2500);
  } catch (err) {
    if (err?.name !== 'AbortError') mostrarError(t('errorCopiar'));
  }
});

async function leerGpx(texto, nombreArchivo, { guardar = true } = {}) {
  mostrarError('');
  const xml = new DOMParser().parseFromString(texto, 'application/xml');
  if (xml.querySelector('parsererror')) {
    return mostrarError(t('errorGpxInvalido', { archivo: nombreArchivo }));
  }
  const nodos = xml.querySelectorAll('trkpt, rtept');
  if (nodos.length > GPX_MAX_PUNTOS) {
    return mostrarError(t('errorGpxPuntos', { archivo: nombreArchivo, n: nf0.format(nodos.length), max: nf0.format(GPX_MAX_PUNTOS) }));
  }
  // parseFloat y no +: un atributo ausente (null) daría 0, una coordenada válida
  const puntos = [...nodos].map((n) => ({
    lat: parseFloat(n.getAttribute('lat')),
    lon: parseFloat(n.getAttribute('lon')),
    ele: n.querySelector('ele') ? +n.querySelector('ele').textContent : null,
  })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (puntos.length < 2) {
    return mostrarError(t('errorGpxSinTrack', { archivo: nombreArchivo }));
  }

  conKm(puntos);

  const nombre = xml.querySelector('trk > name, rte > name, metadata > name')?.textContent.trim() || nombreArchivo.replace(/\.gpx$/i, '');
  ruta = { nombre, puntos };
  await mostrarRutaPropia();
  if (guardar) ruta.idLocal = await guardarRutaLocal(ruta);
  escribirHash();
  pintarMisRutas();
}

// Común a un GPX recién subido y a una ruta guardada en el dispositivo
async function mostrarRutaPropia({ foco = true } = {}) {
  etapaActiva = null;
  marcarEtapa();
  escribirHash(); // un GPX propio no se puede compartir por enlace: quitar la etapa de la URL
  await mapaListo;
  if (movil.matches) abrirPanel(false); // dejar ver la ruta en el mapa; el resumen queda en el asa
  dibujarRuta();
  if (foco) enfocarRuta();
}

function encuadrarRuta() {
  const coords = ruta.puntos.map((p) => [p.lon, p.lat]);
  map.fitBounds(coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0])), { padding: margen(50) });
}

function dibujarRuta() {
  ruta.subeAcum = subidaAcumulada(ruta.puntos);
  $('opcionFirme').hidden = !ruta.tramos?.length;
  pintarTrazado();
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
  $('compartirRuta').hidden = etapaActiva == null;
  ocultarCursor();
  dibujarPerfil();
  mostrarConectados();

  const n = conectadosActuales.length;
  anunciar(
    t('avisoRuta', { nombre: ruta.nombre, km: nf1.format(dist) }) +
      (sube != null ? t('avisoRutaSube', { m: nf0.format(Math.round(sube)) }) : '') +
      '. ' + (n ? t('nRefugiosAMenos', { n, km: $('radioValor').textContent }) + '.' : t('ningunRefugioCerca'))
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
  quitarMarcasNoche();
  ocultarCursor();
  actualizarAsa();
  escribirHash();
  if (encuadrar) {
    if (etapasVisibles()) encuadrarEtapas();
    else map.fitBounds(ISLAS[islaActiva], { padding: margen(30) });
  }
  anunciar(t('rutaQuitada'));
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
  const caja = $('perfilCaja');
  caja.setAttribute('aria-valuemax', nf1.format(total).replace(',', '.'));
  if (pts.length < 2) {
    $('perfilDesc').textContent = t('perfilSinDatos');
    $('perfilMax').textContent = $('perfilMin').textContent = '';
    return (svg.innerHTML = '<line id="perfilCursor" class="cursor" x1="0" x2="0" y1="0" y2="80"/>');
  }
  const min = Math.min(...pts.map((p) => p.ele));
  const max = Math.max(...pts.map((p) => p.ele));
  // Margen arriba y abajo para que las cotas no pisen la línea
  const y = (e) => 74 - ((e - min) / (max - min || 1)) * 54;
  const linea = pts.map((p, i) => `${i ? 'L' : 'M'}${((p.km / total) * 300).toFixed(1)},${y(p.ele).toFixed(1)}`).join('');
  svg.innerHTML = `<path class="area" d="${linea}L300,80L0,80Z"/><path class="linea" d="${linea}"/><g id="perfilMarcas"></g><g id="perfilDias"></g><line id="perfilCursor" class="cursor" x1="0" x2="0" y1="0" y2="80"/>`;
  $('perfilMax').textContent = fM(max);
  $('perfilMin').textContent = fM(min);
  $('perfilDesc').textContent = t('perfilDesc', { min: fM(min), max: fM(max), inicio: fM(pts[0].ele), fin: fM(pts.at(-1).ele) });
}

// ---------- Cursor del perfil enlazado con el mapa ----------
let cursorKm = null;

// Punto interpolado en un km de la ruta (búsqueda binaria sobre los km acumulados)
function puntoEnKm(km) {
  const pts = ruta.puntos;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].km < km) lo = mid; else hi = mid;
  }
  const a = pts[lo], b = pts[hi];
  const t = b.km > a.km ? Math.min(1, Math.max(0, (km - a.km) / (b.km - a.km))) : 0;
  const ele = a.ele != null && b.ele != null ? a.ele + t * (b.ele - a.ele) : (a.ele ?? b.ele);
  return { lon: a.lon + t * (b.lon - a.lon), lat: a.lat + t * (b.lat - a.lat), ele };
}

// Pendiente media en ±100 m alrededor del punto, para que el ruido del GPS no la dispare
function pendienteEn(km) {
  const total = ruta.puntos.at(-1).km;
  const a = Math.max(0, km - 0.1), b = Math.min(total, km + 0.1);
  const ea = puntoEnKm(a).ele, eb = puntoEnKm(b).ele;
  if (ea == null || eb == null || b - a < 0.02) return null;
  return ((eb - ea) / ((b - a) * 1000)) * 100;
}

function mostrarCursor(km) {
  if (!ruta) return;
  const total = ruta.puntos.at(-1).km || 1;
  cursorKm = Math.min(total, Math.max(0, km));
  const p = puntoEnKm(cursorKm);
  const pend = pendienteEn(cursorKm);
  const x = (cursorKm / total) * 300;
  const linea = $('perfilCursor');
  if (linea) {
    linea.setAttribute('x1', x);
    linea.setAttribute('x2', x);
    linea.classList.add('visible');
  }
  const partes = [`km ${nf1.format(cursorKm)}`, p.ele != null && fM(p.ele), pend != null && `${pend > 0 ? '+' : ''}${nf0.format(Math.round(pend))} %`].filter(Boolean);
  const info = $('perfilInfo');
  info.textContent = partes.join(' · ');
  info.style.left = `${Math.min(80, Math.max(20, (cursorKm / total) * 100))}%`;
  info.hidden = false;
  const caja = $('perfilCaja');
  caja.classList.add('con-cursor');
  caja.setAttribute('aria-valuenow', cursorKm.toFixed(1));
  caja.setAttribute('aria-valuetext', partes.join(', ').replace(' %', ` ${t('porCientoPendiente')}`));
  map.getSource('cursor')?.setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: {} });
}

function ocultarCursor() {
  $('perfilCursor')?.classList.remove('visible');
  $('perfilInfo').hidden = true;
  $('perfilCaja').classList.remove('con-cursor');
  map.getSource('cursor')?.setData(vacio());
}

{
  const caja = $('perfilCaja');
  const kmDesdePuntero = (e) => {
    const r = $('perfil').getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * (ruta.puntos.at(-1).km || 1);
  };
  caja.addEventListener('pointerdown', (e) => ruta && mostrarCursor(kmDesdePuntero(e)));
  caja.addEventListener('pointermove', (e) => ruta && (e.pointerType === 'mouse' || e.buttons) && mostrarCursor(kmDesdePuntero(e)));
  caja.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && document.activeElement !== caja && ocultarCursor());
  caja.addEventListener('focus', () => ruta && mostrarCursor(cursorKm ?? 0));
  caja.addEventListener('blur', ocultarCursor);
  caja.addEventListener('keydown', (e) => {
    if (!ruta) return;
    const total = ruta.puntos.at(-1).km;
    const paso = (e.shiftKey ? 10 : 1) * total / 100;
    const km = cursorKm ?? 0;
    const nuevo = { ArrowRight: km + paso, ArrowUp: km + paso, ArrowLeft: km - paso, ArrowDown: km - paso, PageUp: km + total / 10, PageDown: km - total / 10, Home: 0, End: total }[e.key];
    if (nuevo == null) return;
    e.preventDefault();
    mostrarCursor(nuevo);
  });
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

// ---------- Trazado coloreado por pendiente o por firme ----------
let colorRuta = 'ninguno';
const CLASES_PENDIENTE = [
  [3, '#3f9b5a', '0–3 %'], [6, '#c9a400', '3–6 %'], [9, '#e07b00', '6–9 %'], [12, '#d0202a', '9–12 %'], [Infinity, '#5e0d33', t('masDel12')],
];
// Colores fijos: el mapa base es claro también en modo oscuro
const COLOR_FIRME = { asfalto: '#5f5b52', pista: '#b9793a', sendero: '#2f6b2a' };

const linea = (pts, c) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lon, p.lat]) }, properties: c ? { c } : {} });

function segmentosRuta() {
  const pts = ruta.puntos;
  if (colorRuta === 'pendiente') {
    // Tramos de unos 200 m: suficiente detalle sin que el ruido del GPS pinte cada metro
    const out = [];
    let i0 = 0;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].km - pts[i0].km < 0.2 && i < pts.length - 1) continue;
      const a = pts[i0], b = pts[i];
      const pend = a.ele != null && b.ele != null ? Math.abs((b.ele - a.ele) / ((b.km - a.km || 1e-6) * 1000)) * 100 : null;
      out.push(linea(pts.slice(i0, i + 1), pend == null ? null : CLASES_PENDIENTE.find(([max]) => pend < max)[1]));
      i0 = i;
    }
    return out;
  }
  if (colorRuta === 'firme' && ruta.tramos?.length) {
    let desde = 0;
    return ruta.tramos.map((t) => {
      const i = indiceEnKm(desde), j = indiceEnKm(t.hasta);
      const tramo = j > i ? pts.slice(i, j + 1) : [puntoEnKm(desde), puntoEnKm(t.hasta)];
      desde = t.hasta;
      return linea(tramo, COLOR_FIRME[t.tipo]);
    });
  }
  return [linea(pts)];
}

function pintarTrazado() {
  if (!ruta) return;
  if (colorRuta === 'firme' && !ruta.tramos?.length) ponerColorRuta('ninguno', false);
  map.getSource('ruta')?.setData({ type: 'FeatureCollection', features: segmentosRuta() });
  const ley = $('leyendaTrazado');
  const filas = colorRuta === 'pendiente'
    ? CLASES_PENDIENTE.map(([, c, texto]) => [c, texto])
    : colorRuta === 'firme' ? TIPOS_FIRME.map((k) => [COLOR_FIRME[k], t(k)]) : [];
  ley.hidden = !filas.length;
  ley.innerHTML = filas.map(([, texto]) => `<li><i class="muestra"></i>${texto}</li>`).join('') + (colorRuta === 'pendiente' ? `<li class="nota">${t('subeOBaja')}</li>` : '');
  ley.querySelectorAll('.muestra').forEach((m, k) => (m.style.background = filas[k][0]));
}

function ponerColorRuta(valor, redibujar = true) {
  colorRuta = valor;
  document.querySelectorAll('[name="colorRuta"]').forEach((r) => (r.checked = r.value === valor));
  if (redibujar) pintarTrazado();
}
document.querySelectorAll('[name="colorRuta"]').forEach((r) =>
  r.addEventListener('change', () => {
    ponerColorRuta(r.value);
    escribirHash();
  })
);

// ---------- Plan por días: dónde dormir entre los refugios conectados ----------
let marcasNoche = [];

// Subida acumulada en cada punto, con la misma histéresis de 3 m que el desnivel total
function subidaAcumulada(puntos) {
  let acum = 0, ref = null;
  return puntos.map((p) => {
    if (p.ele != null && Number.isFinite(p.ele)) {
      if (ref == null) ref = p.ele;
      else if (p.ele - ref >= 3) { acum += p.ele - ref; ref = p.ele; }
      else if (ref - p.ele >= 3) ref = p.ele;
    }
    return acum;
  });
}

function indiceEnKm(km) {
  const pts = ruta.puntos;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].km < km) lo = mid; else hi = mid;
  }
  return pts[lo].km >= km ? lo : hi;
}
const subidaEntre = (a, b) => ruta.subeAcum[indiceEnKm(b)] - ruta.subeAcum[indiceEnKm(a)];

// Hasta dónde se llega desde «inicio» sin pasar de los km ni de la subida del día
function kmAlcanzable(inicio, maxKm, maxSube) {
  const pts = ruta.puntos;
  const base = ruta.subeAcum[indiceEnKm(inicio)];
  let fin = inicio;
  for (let i = indiceEnKm(inicio); i < pts.length; i++) {
    if (pts[i].km > inicio + maxKm || ruta.subeAcum[i] - base > maxSube) break;
    fin = pts[i].km;
  }
  return fin;
}

function planificarDias() {
  if (!ruta) return;
  const total = ruta.puntos.at(-1).km;
  const maxKm = +$('diaKm').value, maxSube = +$('diaSube').value;
  const dias = [];
  let inicio = 0;
  while (inicio < total - 0.05 && dias.length < 30) {
    let lim = kmAlcanzable(inicio, maxKm, maxSube);
    if (lim >= total - 0.05) { dias.push({ desde: inicio, hasta: total }); break; }
    // El refugio más lejano al que se llega ese día (al menos a 1 km del punto de salida)
    const refugio = conectadosActuales.filter((c) => c.km > inicio + 1 && c.km <= lim).at(-1);
    if (refugio) {
      dias.push({ desde: inicio, hasta: refugio.km, refugio });
      inicio = refugio.km;
    } else {
      if (lim < inicio + 1) lim = Math.min(total, inicio + 1); // una subida muy dura no puede dejarnos parados
      dias.push({ desde: inicio, hasta: lim, sinRefugio: true });
      inicio = lim;
    }
  }
  pintarPlan(dias);
}

function pintarPlan(dias) {
  const ol = $('planDias');
  ol.innerHTML = '';
  dias.forEach((d, k) => {
    const sube = subidaEntre(d.desde, d.hasta);
    const ultimo = k === dias.length - 1;
    const fin = ultimo
      ? t('llegada')
      : d.refugio
        ? `${esc(t('nocheEn', { nombre: d.refugio.f.properties.nombre }))} · ${textoDesvio(d.refugio.dist)}`
        : t('sinRefugioTramo', { km: nf0.format(d.hasta) });
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = d.sinRefugio && !ultimo ? 'sin-refugio' : '';
    b.innerHTML = `<span><b>${t('diaN', { n: k + 1 })}</b> · ${fKm(d.hasta - d.desde)} · +${fM(sube)}<small>${fin}</small></span>`;
    b.addEventListener('click', () => encuadrarTramo(d.desde, d.hasta));
    li.append(b);
    ol.append(li);
  });

  // Fin de cada día en el perfil y refugios de noche numerados en el mapa
  const total = ruta.puntos.at(-1).km || 1;
  quitarMarcasNoche();
  const g = document.getElementById('perfilDias');
  if (g) g.innerHTML = dias.slice(0, -1).map((d) => { const x = ((d.hasta / total) * 300).toFixed(1); return `<line class="fin-dia" x1="${x}" x2="${x}" y1="0" y2="80"/>`; }).join('');
  dias.slice(0, -1).forEach((d, k) => {
    const el = document.createElement('div');
    el.className = `marca-noche${d.sinRefugio ? ' sin-refugio' : ''}`;
    el.innerHTML = `<i><b>${k + 1}</b></i>`;
    el.title = d.refugio ? `${t('nocheN', { n: k + 1 })}: ${d.refugio.f.properties.nombre}` : t('finDiaN', { n: k + 1 });
    const pos = d.refugio ? d.refugio.f.geometry.coordinates : (({ lon, lat }) => [lon, lat])(puntoEnKm(d.hasta));
    marcasNoche.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(pos).addTo(map));
  });
}

function quitarMarcasNoche() {
  marcasNoche.forEach((m) => m.remove());
  marcasNoche = [];
  const g = document.getElementById('perfilDias');
  if (g) g.innerHTML = '';
}

function encuadrarTramo(desde, hasta) {
  const pts = ruta.puntos.slice(indiceEnKm(desde), indiceEnKm(hasta) + 1);
  if (pts.length < 2) return;
  if (movil.matches) abrirPanel(false);
  map.fitBounds(pts.reduce((b, p) => b.extend([p.lon, p.lat]), new maplibregl.LngLatBounds([pts[0].lon, pts[0].lat], [pts[0].lon, pts[0].lat])), { padding: margen(50) });
}

function ponerLimitesDia(km, sube) {
  const n = (v, min, max, def) => (Number(v) >= min && Number(v) <= max ? String(Number(v)) : def);
  $('diaKm').value = n(km, 20, 150, '60');
  $('diaSube').value = n(sube, 300, 3000, '1500');
  actualizarLimitesDia();
}
function actualizarLimitesDia() {
  $('diaKmValor').textContent = $('diaKm').value;
  $('diaSubeValor').textContent = nf0.format(+$('diaSube').value);
  $('diaKm').setAttribute('aria-valuetext', t('kmAlDiaAria', { n: $('diaKm').value }));
  $('diaSube').setAttribute('aria-valuetext', t('subidaAlDiaAria', { n: $('diaSube').value }));
}
for (const id of ['diaKm', 'diaSube']) {
  $(id).addEventListener('input', () => {
    actualizarLimitesDia();
    if (!ruta) return;
    planificarDias();
    clearTimeout(planificarDias.t);
    planificarDias.t = setTimeout(() => anunciar(t('planDeNDias', { n: $('planDias').children.length })), 500);
  });
  $(id).addEventListener('change', escribirHash);
}

function textoDesvio(dist) {
  if (dist < 0.1) return t('aPieDeRuta');
  if (dist < 1) return t('aDelTrazado', { d: `${nf0.format(Math.round(dist * 100) * 10)} m` });
  return t('aDelTrazado', { d: fKm(dist) });
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
    : `<li class="vacio">${t('ningunRefugioRadio', { km: $('radioValor').textContent })}</li>`;
  for (const c of conectadosActuales) {
    ol.append(botonRefugio(c.f, `${esc(c.f.properties.nombre)}<small>${t('enElKm', { km: nf1.format(c.km) })} · ${textoDesvio(c.dist)} · ${TIPO_TEXTO[c.f.properties.tipo]}</small>`, true));
  }
  marcarRefugiosEnPerfil();
  planificarDias();
  actualizarAsa();
  if (anunciarCambio) {
    clearTimeout(mostrarConectados.t);
    const n = conectadosActuales.length;
    mostrarConectados.t = setTimeout(() => anunciar(t('nRefugiosAMenos', { n, km: $('radioValor').textContent }) + '.'), 400);
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

// Solo enlaces http(s): los datos vienen de OpenStreetMap, que edita cualquiera, y esc() no frena «javascript:»
function urlSegura(valor) {
  if (!valor) return null;
  try {
    const u = new URL(String(valor).trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}


// ---------- App instalable y uso sin conexión ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('No se ha podido activar el modo sin conexión', err));
}

function actualizarConexion() {
  $('sinConexion').hidden = navigator.onLine;
}
window.addEventListener('online', actualizarConexion);
window.addEventListener('offline', () => {
  actualizarConexion();
  anunciar(t('sinConexionAviso'));
});
actualizarConexion();

// El navegador avisa cuando la app se puede instalar; hasta entonces el bloque queda oculto
let avisoInstalar = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  avisoInstalar = e;
  $('instalar').hidden = false;
});
$('botonInstalar').addEventListener('click', async () => {
  if (!avisoInstalar) return;
  avisoInstalar.prompt();
  await avisoInstalar.userChoice;
  avisoInstalar = null;
  $('instalar').hidden = true;
});
window.addEventListener('appinstalled', () => ($('instalar').hidden = true));

// ---------- Rutas propias guardadas en el dispositivo (IndexedDB) ----------
// Solo viven en este navegador: no se envían a ningún servidor.
const MAX_RUTAS_LOCALES = 50;
let baseDatos = null;
function abrirBaseDatos() {
  baseDatos ??= new Promise((ok, mal) => {
    const pet = indexedDB.open('rutas-y-refugios', 1);
    pet.onupgradeneeded = () => pet.result.createObjectStore('rutas', { keyPath: 'id', autoIncrement: true });
    pet.onsuccess = () => ok(pet.result);
    pet.onerror = () => mal(pet.error);
  });
  return baseDatos;
}
async function almacen(modo) {
  return (await abrirBaseDatos()).transaction('rutas', modo).objectStore('rutas');
}
const peticion = (pet) => new Promise((ok, mal) => { pet.onsuccess = () => ok(pet.result); pet.onerror = () => mal(pet.error); });

async function listarRutasLocales() {
  try {
    return (await peticion((await almacen('readonly')).getAll())).sort((a, b) => b.fecha - a.fecha);
  } catch {
    return null; // navegación privada o almacenamiento bloqueado
  }
}

async function guardarRutaLocal(r) {
  try {
    const dist = r.puntos.at(-1).km;
    const lista = (await listarRutasLocales()) || [];
    // La misma ruta subida otra vez no se duplica: se actualiza la fecha
    const igual = lista.find((x) => x.nombre === r.nombre && Math.abs(x.dist - dist) < 0.05);
    const registro = { nombre: r.nombre, dist, fecha: Date.now(), puntos: r.puntos.map((p) => [p.lat, p.lon, p.ele]) };
    if (igual) registro.id = igual.id;
    const id = await peticion((await almacen('readwrite')).put(registro));
    // Solo las más recientes: las antiguas se borran al pasar del límite
    for (const vieja of lista.filter((x) => x.id !== id).slice(MAX_RUTAS_LOCALES - 1)) await borrarRutaLocal(vieja.id);
    return id;
  } catch {
    return null;
  }
}

async function borrarRutaLocal(id) {
  try { await peticion((await almacen('readwrite')).delete(id)); } catch { /* nada que borrar */ }
}

async function abrirRutaLocal(id, { foco = true } = {}) {
  let r;
  try { r = await peticion((await almacen('readonly')).get(id)); } catch { r = null; }
  if (!r) { escribirHash(); return; } // borrada o en otro dispositivo: se ignora
  ruta = { nombre: r.nombre, puntos: conKm(r.puntos.map(([lat, lon, ele]) => ({ lat, lon, ele }))), idLocal: r.id };
  if (pestana !== 'subir') cambiarPestana('subir');
  await mostrarRutaPropia({ foco });
  escribirHash();
}

const formatoFecha = new Intl.DateTimeFormat(idioma, { day: 'numeric', month: 'short', year: 'numeric' });
async function pintarMisRutas() {
  const lista = await listarRutasLocales();
  const ul = $('listaMisRutas');
  $('misRutas').hidden = !lista?.length;
  ul.innerHTML = '';
  for (const r of lista || []) {
    const li = document.createElement('li');
    li.className = 'mi-ruta';
    const abrir = document.createElement('button');
    abrir.type = 'button';
    abrir.innerHTML = `<span>${esc(r.nombre)}<small>${fKm(r.dist)} · ${formatoFecha.format(r.fecha)}</small></span>`;
    abrir.addEventListener('click', () => abrirRutaLocal(r.id));
    const borrar = document.createElement('button');
    borrar.type = 'button';
    borrar.className = 'quitar';
    borrar.setAttribute('aria-label', t('borrarRuta', { nombre: r.nombre }));
    borrar.title = t('borrarRuta', { nombre: r.nombre });
    borrar.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
    borrar.addEventListener('click', async () => {
      if (!confirm(t('confirmarBorrar', { nombre: r.nombre }))) return;
      await borrarRutaLocal(r.id);
      if (ruta?.idLocal === r.id) quitarRuta({ foco: false });
      await pintarMisRutas();
      anunciar(t('rutaBorrada'));
      ($('listaMisRutas').querySelector('button') || $('gpx')).focus();
    });
    li.append(abrir, borrar);
    ul.append(li);
  }
}
if ('indexedDB' in window) pintarMisRutas();

// ---------- Selector de idioma ----------
{
  const sel = $('idioma');
  for (const [codigo, nombre] of Object.entries(IDIOMAS)) {
    const op = document.createElement('option');
    op.value = codigo;
    op.lang = codigo;
    op.textContent = nombre;
    op.selected = codigo === idioma;
    sel.append(op);
  }
  // Recargar con el nuevo idioma: el estado (isla, etapa, capas…) va en la URL y se conserva
  sel.addEventListener('change', () => {
    guardarIdioma(sel.value);
    location.reload();
  });
}

// Estado inicial desde la URL (enlace compartido): al final, cuando todo lo anterior ya está definido
if (location.hash.length > 1) aplicarHash(hashInicial);
