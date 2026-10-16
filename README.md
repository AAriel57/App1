# Rutas y Refugios · Illes Balears

Web comunitaria de rutas de BTT conectadas a refugios de montaña en Mallorca, Menorca y Eivissa.

## Qué hace (prototipo)
- Mapa topográfico (OpenTopoMap) con los refugios de las islas, obtenidos de OpenStreetMap.
- Subida de un track GPX: distancia, desnivel, altitud máxima y perfil de altimetría.
- Detecta los refugios a menos de N km de la ruta y los ordena por el km en que aparecen.
- Filtro por isla.
- Pestaña «Travesías»: 7 etapas de refugio a refugio en Mallorca (Galatzó → s'Arenalet des Verger), con reparto de asfalto/pista/sendero y descarga en GPX.
- Perfil de altimetría enlazado al mapa y trazado coloreado por pendiente o por firme.
- Plan por días: reparte la ruta en jornadas según km y subida diaria y propone en qué refugio dormir.
- Mapas base topográfico y ciclista (CyclOSM), con las rutas MTB señalizadas de Waymarked Trails.
- Enlaces compartibles: la isla, la etapa, las capas y el plan van en la dirección (`#etapa=3&mapa=bici`).
- App instalable que funciona sin conexión con las zonas del mapa ya vistas.
- En español, català, English y Deutsch (textos en `i18n.js`).

Las rutas que sube cada usuario se guardan solo en su navegador (IndexedDB): todavía no se comparten con nadie.

## Ejecutar en local
No hace falta instalar nada en Windows:

```bash
powershell -ExecutionPolicy Bypass -File scripts/serve.ps1
```

Abre http://localhost:8080 y sube `data/ejemplo-prueba.gpx` (track sintético, solo para pruebas).

## Publicación
La web está en https://aariel57.github.io/App1/ y GitHub Pages la sirve desde la rama `gh-pages`. Para publicar los cambios de `main`:

```bash
git push origin main:gh-pages
```

Si cambias la lista de archivos de la app, añádelos a `sw.js` y sube su `VERSION` para que el modo sin conexión los recoja.

## Actualizar los refugios desde OpenStreetMap

```bash
powershell -ExecutionPolicy Bypass -File scripts/fetch-huts.ps1
```

## Regenerar las etapas de Mallorca
Se calculan con BRouter (perfil trekking) entre los refugios de `data/refugios.geojson` y se guardan en `data/rutas.geojson`:

```bash
powershell -ExecutionPolicy Bypass -File scripts/fetch-rutas.ps1
```

## Datos
Datos de refugios y caminos © colaboradores de OpenStreetMap (ODbL); rutas calculadas con BRouter. Mapa base © OpenTopoMap (CC-BY-SA).

## Próximos pasos
- Backend (Supabase + PostGIS) con cuentas de usuario para publicar y compartir rutas.
- Añadir y corregir refugios desde la web (Menorca e Eivissa apenas tienen datos en OSM).
- Fichas de ruta y valoraciones; etapas de BTT con más pista y sendero, revisadas sobre el terreno.
