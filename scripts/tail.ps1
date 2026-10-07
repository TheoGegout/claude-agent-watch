# Prints the end of a large file (AW_BYTES of it, cut to whole lines), and its
# first line before it when AW_FIRST is set: a seek, not a read of the file.
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
$fs = [IO.File]::Open($env:AW_PATH, 'Open', 'Read', 'ReadWrite')
try {
  $len = $fs.Length
  if ($env:AW_FIRST) {
    $head = New-Object byte[] ([Math]::Min($len, 262144))
    [void]$fs.Read($head, 0, $head.Length)
    $text = [Text.Encoding]::UTF8.GetString($head)
    $cut = $text.IndexOf("`n")
    if ($cut -ge 0) { $text = $text.Substring(0, $cut) }
    [Console]::Out.Write($text + "`n")
  }
  $start = [Math]::Max(0, $len - [long]$env:AW_BYTES)
  [void]$fs.Seek($start, 'Begin')
  $buf = New-Object byte[] ($len - $start)
  $read = 0
  while ($read -lt $buf.Length) {
    $n = $fs.Read($buf, $read, $buf.Length - $read)
    if ($n -le 0) { break }
    $read += $n
  }
  $tail = [Text.Encoding]::UTF8.GetString($buf, 0, $read)
  if ($start -gt 0) {
    $cut = $tail.IndexOf("`n")
    if ($cut -ge 0) { $tail = $tail.Substring($cut + 1) }
  }
  [Console]::Out.Write($tail)
} finally {
  $fs.Dispose()
}
