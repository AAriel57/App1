# Servidor estático mínimo para desarrollo (no requiere Node ni Python).
# Uso: powershell -File scripts/serve.ps1 [-Port 8080]
param([int]$Port = 8080)

# Ruta raíz terminada en separador: así «App-copia\» no pasa la comprobación de prefijo
$root = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent)).TrimEnd('\') + '\'
# Solo se sirven estos tipos; el resto (.ps1, .md, .exe, .json de configuración…) devuelve 404
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.geojson' = 'application/geo+json'
  '.gpx' = 'application/gpx+xml'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.ico' = 'image/x-icon'
}

$listener = [Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
"Sirviendo $root en http://localhost:$Port/"

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $ctx.Response.Headers.Add('X-Content-Type-Options', 'nosniff')
  $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
  if (-not $path) { $path = 'index.html' }
  $file = [IO.Path]::GetFullPath((Join-Path $root $path))
  $relativa = if ($file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { $file.Substring($root.Length) } else { $null }
  $ext = [IO.Path]::GetExtension($file).ToLower()
  # Nada fuera de la raíz, nada oculto (.git, .claude, .env…) y solo extensiones conocidas
  $permitido = $relativa -and -not ($relativa -split '[\\/]' | Where-Object { $_.StartsWith('.') }) -and $types.ContainsKey($ext)
  if ($ctx.Request.HttpMethod -notin 'GET', 'HEAD') {
    $ctx.Response.StatusCode = 405
  } elseif ($permitido -and (Test-Path -LiteralPath $file -PathType Leaf)) {
    $bytes = [IO.File]::ReadAllBytes($file)
    $ctx.Response.ContentType = $types[$ext]
    $ctx.Response.ContentLength64 = $bytes.Length
    # HEAD solo lleva cabeceras; escribir el cuerpo lanza ProtocolViolationException
    if ($ctx.Request.HttpMethod -ne 'HEAD') { $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length) }
  } else {
    $ctx.Response.StatusCode = 404
  }
  $ctx.Response.Close()
}
