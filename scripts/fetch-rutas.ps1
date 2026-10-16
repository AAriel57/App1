# Genera data/rutas.geojson: etapas en bici de refugio a refugio por Mallorca, calculadas con BRouter
# (perfil "trekking": pistas y carreteras secundarias; el perfil "mtb" se mete por senderos del GR221
# que no son ciclables). Uso: powershell -File scripts/fetch-rutas.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

# Travesía de oeste a este por los refugios guardados y albergues (ids de data/refugios.geojson)
$etapas = @(
  @('osm-way-47280929', 'osm-node-3786829462'),   # Galatzó → Hort de Son Tries
  @('osm-node-3786829462', 'osm-way-52612938'),   # Hort de Son Tries → Muleta
  @('osm-way-52612938', 'osm-way-98324787'),      # Muleta → Tossals Verds
  @('osm-way-98324787', 'osm-node-612044820'),    # Tossals Verds → Son Amer
  @('osm-node-612044820', 'osm-node-612044795'),  # Son Amer → Pont Romà
  @('osm-node-612044795', 'osm-node-2661752048'), # Pont Romà → Ermita de la Victòria
  @('osm-node-2661752048', 'osm-way-136030096')   # Ermita de la Victòria → s'Arenalet des Verger
)

$refugios = @{}
(Get-Content "$root\data\refugios.geojson" -Raw -Encoding UTF8 | ConvertFrom-Json).features | % { $refugios[$_.properties.id] = $_ }

$inv = [Globalization.CultureInfo]::InvariantCulture
function Num($x, $dec) { [math]::Round([double]$x, $dec).ToString($inv) }
function Json($s) { '"' + ($s -replace '\\', '\\' -replace '"', '\"') + '"' }

function Tipo-Firme($tags) {
  $t = @{}; foreach ($kv in $tags -split ' ') { $p = $kv -split '=', 2; if ($p.Count -eq 2) { $t[$p[0]] = $p[1] } }
  if ($t.highway -in 'path', 'footway', 'bridleway', 'steps') { 'sendero' }
  elseif ($t.highway -eq 'track' -or $t.surface -match 'unpaved|gravel|dirt|ground|compacted|grass|earth|sand|rock') { 'pista' }
  else { 'asfalto' }
}

$features = @()
$n = 0
foreach ($e in $etapas) {
  $n++
  $a = $refugios[$e[0]]; $b = $refugios[$e[1]]
  if (-not $a -or -not $b) { throw "Etapa $n`: no encuentro el refugio $($e[0]) o $($e[1]) en refugios.geojson" }
  # Formato invariante: con la cultura es-ES, 2.47 se convertiría en "2,47"
  $lonlats = (($a.geometry.coordinates | % { Num $_ 6 }) -join ',') + '|' + (($b.geometry.coordinates | % { Num $_ 6 }) -join ',')
  $url = "https://brouter.de/brouter?lonlats=$($lonlats -replace '\|', '%7C')&profile=trekking&alternativeidx=0&format=geojson"
  "Etapa $n`: $($a.properties.nombre) → $($b.properties.nombre)"
  $raw = (curl.exe -s --max-time 120 -A 'App1-rutas-refugios/0.1' $url) -join "`n"
  if (-not $raw.TrimStart().StartsWith('{')) { throw "BRouter no devolvió una ruta para la etapa $n`: $raw" }
  $r = $raw | ConvertFrom-Json
  $f = $r.features[0]

  # Reparto de la distancia por tipo de firme, a partir de las etiquetas OSM de cada tramo
  $m = $f.properties.messages
  $iD = [array]::IndexOf($m[0], 'Distance'); $iT = [array]::IndexOf($m[0], 'WayTags')
  $firme = @{ asfalto = 0; pista = 0; sendero = 0 }
  # Tramos para pintar el firme sobre el trazado: [metros acumulados al final del tramo, a|p|s],
  # fusionando los tramos seguidos del mismo tipo
  $tramos = [Collections.Generic.List[object]]::new()
  $acum = 0
  $m | select -Skip 1 | % {
    $tipo = Tipo-Firme $_[$iT]
    $firme[$tipo] += [int]$_[$iD]
    $acum += [int]$_[$iD]
    $letra = $tipo.Substring(0, 1)
    if ($tramos.Count -and $tramos[$tramos.Count - 1][1] -eq $letra) { $tramos[$tramos.Count - 1][0] = $acum }
    else { $tramos.Add(@($acum, $letra)) }
  }
  $total = [math]::Max(1, ($firme.Values | measure -Sum).Sum)
  $tramosJson = ($tramos | % { "[$($_[0]),`"$($_[1])`"]" }) -join ','

  $coords = ($f.geometry.coordinates | % { "[$(Num $_[0] 5),$(Num $_[1] 5),$(Num $_[2] 0)]" }) -join ','
  $props = @(
    "`"id`":`"etapa-$n`"", "`"etapa`":$n",
    "`"desde`":$(Json $a.properties.id)", "`"hasta`":$(Json $b.properties.id)",
    "`"nombre`":$(Json "$($a.properties.nombre) → $($b.properties.nombre)")",
    "`"asfalto`":$([math]::Round(100 * $firme.asfalto / $total))",
    "`"pista`":$([math]::Round(100 * $firme.pista / $total))",
    "`"sendero`":$([math]::Round(100 * $firme.sendero / $total))",
    "`"tramos`":[$tramosJson]"
  ) -join ','
  $features += "{`"type`":`"Feature`",`"properties`":{$props},`"geometry`":{`"type`":`"LineString`",`"coordinates`":[$coords]}}"
  Start-Sleep -Seconds 2 # no saturar el servidor público de BRouter
}

$json = "{`"type`":`"FeatureCollection`",`"features`":[`n" + ($features -join ",`n") + "`n]}"
[IO.File]::WriteAllText("$root\data\rutas.geojson", $json, [Text.UTF8Encoding]::new($false))
"Guardadas $($features.Count) etapas en data/rutas.geojson"
