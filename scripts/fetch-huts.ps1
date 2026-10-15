# Descarga refugios de Mallorca, Menorca e Eivissa desde OpenStreetMap (Overpass)
# y genera data/refugios.geojson. Uso: powershell -File scripts/fetch-huts.ps1

$root = Split-Path $PSScriptRoot -Parent
$query = @'
[out:json][timeout:90];
(
  nwr["tourism"~"alpine_hut|wilderness_hut"](38.6,1.1,40.15,4.4);
  nwr["amenity"="shelter"]["shelter_type"="basic_hut"]["name"](38.6,1.1,40.15,4.4);
  nwr["tourism"="hostel"]["name"~"[Rr]efugi|[Aa]lberg|[Cc]ol.nies|[Hh]ost.[gt]eria"](38.6,1.1,40.15,4.4);
);
out tags center;
'@

$tmpQuery = New-TemporaryFile
$tmpOut = New-TemporaryFile
Set-Content -Path $tmpQuery -Value $query -Encoding ASCII
curl.exe -s --max-time 120 -A "App1-rutas-refugios/0.1" --data-urlencode "data@$tmpQuery" -o $tmpOut https://overpass-api.de/api/interpreter
$raw = Get-Content $tmpOut -Raw -Encoding UTF8
Remove-Item $tmpQuery, $tmpOut
if (-not $raw.TrimStart().StartsWith('{')) {
  Write-Error "Overpass no devolvió JSON (¿límite de peticiones?). Inténtalo en un minuto. No se ha modificado el archivo."
  exit 1
}
$osm = $raw | ConvertFrom-Json

function Get-Isla($lat, $lon) {
  if ($lon -gt 3.6) { 'Menorca' } elseif ($lon -lt 1.7) { 'Eivissa' } elseif ($lat -lt 39.0) { 'Formentera' } else { 'Mallorca' }
}

$features = foreach ($e in $osm.elements) {
  $t = $e.tags
  if (-not $t.name -or $t.name -match 'vigil.ncia') { continue }
  $lat = if ($e.center) { $e.center.lat } else { $e.lat }
  $lon = if ($e.center) { $e.center.lon } else { $e.lon }
  $tipo = switch ($true) {
    ($t.tourism -eq 'alpine_hut') { 'guardado'; break }
    ($t.tourism -eq 'hostel') { 'albergue'; break }
    default { 'libre' }
  }
  [ordered]@{
    type = 'Feature'
    geometry = [ordered]@{ type = 'Point'; coordinates = @([math]::Round($lon, 6), [math]::Round($lat, 6)) }
    properties = [ordered]@{
      id = "osm-$($e.type)-$($e.id)"
      nombre = $t.name
      tipo = $tipo
      isla = Get-Isla $lat $lon
      altitud = $t.ele
      capacidad = $t.capacity
      web = if ($t.website) { $t.website } else { $t.'contact:website' }
      telefono = if ($t.phone) { $t.phone } else { $t.'contact:phone' }
      operador = $t.operator
    }
  }
}

$geojson = [ordered]@{ type = 'FeatureCollection'; features = @($features) }
New-Item -ItemType Directory -Force (Join-Path $root 'data') | Out-Null
$out = Join-Path $root 'data/refugios.geojson'
[IO.File]::WriteAllText($out, ($geojson | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
"$(@($features).Count) refugios guardados en $out"
