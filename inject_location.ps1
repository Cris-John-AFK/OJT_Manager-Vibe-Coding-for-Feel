$file = 'c:\Users\crisj\OneDrive\Documents\Application\index.html'
$content = [System.IO.File]::ReadAllText($file)

$locationWidget = @'

      <div class="native-group" style="margin-top: 1rem;">
        <label style="display:flex;align-items:center;justify-content:space-between;">
          <span>&#128205; Location Snapshot</span>
          <button type="button" id="refresh-location-btn" style="background:none;border:none;color:var(--primary);font-size:0.8rem;cursor:pointer;padding:0;text-decoration:underline;">&#8635; Refresh</button>
        </label>
        <div id="location-display" style="margin-top:6px;padding:10px 12px;border-radius:8px;background:var(--bg-surface);border:1px solid var(--border);font-size:0.78rem;color:var(--text-secondary);display:flex;align-items:center;gap:8px;min-height:40px;">
          <span id="location-display-text" style="flex:1;">Acquiring location...</span>
          <a id="location-map-link" href="#" target="_blank" style="display:none;color:var(--primary);font-size:0.75rem;white-space:nowrap;text-decoration:none;">Open Map &#8599;</a>
        </div>
      </div>

'@

# Find the notes textarea div start
$needle = '<div class="native-group" style="margin: 1.5rem 0;">' + "`n" + '        <textarea id="log-notes-input"'

if ($content.Contains($needle)) {
    $content = $content.Replace($needle, $locationWidget + $needle)
    [System.IO.File]::WriteAllText($file, $content, [System.Text.Encoding]::UTF8)
    Write-Host "SUCCESS: Location widget injected!"
} else {
    Write-Host "NEEDLE NOT FOUND, trying alternative..."
    $idx = $content.IndexOf('id="log-notes-input"')
    Write-Host "Textarea pos: $idx"
    Write-Host "Char before: " + [int]$content[$idx-80]
    
    # Manual char dump
    $chars = $content.Substring($idx-90, 10) | ForEach-Object { [int][char]$_ }
    Write-Host "Chars: $chars"
}
