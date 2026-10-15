# Rutas y Refugios · Illes Balears

Web comunitaria de rutas de BTT conectadas a refugios de montaña en Mallorca, Menorca y Eivissa.

## Qué hace (prototipo)
- Mapa topográfico (OpenTopoMap) con los refugios de las islas, obtenidos de OpenStreetMap.
- Subida de un track GPX: distancia, desnivel, altitud máxima y perfil de altimetría.
- Detecta los refugios a menos de N km de la ruta y los ordena por el km en que aparecen.
- Filtro por isla.

Por ahora las rutas solo se procesan en el navegador; todavía no se guardan ni se comparten.

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

## Actualizar los refugios desde OpenStreetMap

```bash
powershell -ExecutionPolicy Bypass -File scripts/fetch-huts.ps1
```

## Datos
Datos de refugios © colaboradores de OpenStreetMap (ODbL). Mapa base © OpenTopoMap (CC-BY-SA).

## Próximos pasos
- Backend (Supabase + PostGIS) con cuentas de usuario para publicar y compartir rutas.
- Añadir y corregir refugios desde la web (Menorca e Eivissa apenas tienen datos en OSM).
- Fichas de ruta, valoraciones y planificador de travesías refugio a refugio.
