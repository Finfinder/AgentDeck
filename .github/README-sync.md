README — Synchronizacja meta i issue GitHub
=========================================

Cel
----
Krótki przewodnik dla kontrybutorów opisujący workflow synchronizacji metadanych GitHub i seedowania issue.

Pliki źródłowe (source of truth)
--------------------------------
- `.github/gh-sync.json` — definicja etykiet, milestone'ów i roadmapy (źródło prawdy dla metadanych repo).
- `.github/issue-seed.json` — lista issue do zaimportowania (pola: `title`, `body`, `labels`, `milestone`, `sourceId`).

Co edytować w tych plikach
--------------------------
- Etykiety (`labels`): `name`, `color`, `description`.
- Milestones: `title`, `due_on`, `description`.
- Roadmapa: struktura zgodna z `gh-sync.json` (sekcje i przypisania milestone'ów).
- `issue-seed.json` — każde issue powinno zawierać przynajmniej: `title`, `body`, `labels` (lista), `milestone` (tytuł), `sourceId` (unikalny identyfikator zewnętrzny).

Sekwencja uruchamiania (workflow)
----------------------------------
1. `sync-github-meta.ps1` — synchronizuje etykiety i milestone'y z `.github/gh-sync.json`.
2. `seed-github-issues.ps1` — importuje/aktualizuje issue według `.github/issue-seed.json`.

Uwaga: domyślne działanie skryptów to dry-run (symulacja). Aby zatwierdzić zmiany dodaj flagę `-Apply`.

Przykładowe polecenia PowerShell
--------------------------------
Dry-run (symulacja):

```powershell
# z repo root
.\.github\sync-github-meta.ps1
.\.github\seed-github-issues.ps1
```

Apply (zatwierdź zmiany):

```powershell
# zatwierdza metadane
.\.github\sync-github-meta.ps1 -Apply
# następnie seed issue (zatwierdza zmiany)
.\.github\seed-github-issues.ps1 -Apply
```

Sprawdzanie kodowania plików (wymóg UTF-8)
------------------------------------------
Przed uruchomieniem zawsze sprawdź, że pliki `.github/gh-sync.json` i `.github/issue-seed.json` są w UTF-8 (bez BOM preferowane).

Krótka komenda PowerShell sprawdzająca BOM/encoding:

```powershell
$file = '.github/gh-sync.json'
$bytes = Get-Content $file -Encoding Byte -Raw
if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { "UTF-8 with BOM" } else { "No BOM — likely UTF-8 without BOM" }
```

Możesz przekonwertować do UTF-8 bez BOM:

```powershell
Get-Content $file -Raw | Out-File $file -Encoding utf8
```

Backup i recovery
-----------------
Przed wykonaniem `-Apply` zrób szybki snapshot issues i milestone'ów przez REST API GitHub (wymagany `GITHUB_TOKEN`):

```powershell
$repo = "OWNER/REPO"
$hdr = @{ Authorization = "token $env:GITHUB_TOKEN" }
Invoke-RestMethod -Headers $hdr -Uri "https://api.github.com/repos/$repo/issues?state=all&per_page=100" -OutFile "backup/issues-snapshot.json"
Invoke-RestMethod -Headers $hdr -Uri "https://api.github.com/repos/$repo/milestones?state=all&per_page=100" -OutFile "backup/milestones-snapshot.json"
```

Jak cofnąć zmiany po Apply
- Szybki rollback commitem: jeśli zmiany w plikach repo zostały skommitowane, użyj `git revert <commit>` aby utworzyć commit odwracający.
- Alternatywnie: przywróć starą wersję `issue-seed.json` (np. `git checkout <old-sha> -- .github/issue-seed.json`) i ponownie uruchom `seed-github-issues.ps1 -Apply` używając poprzedniego pliku.

Walidacje które skrypty powinny wykonywać
----------------------------------------
Skrypty powinny wykonywać przynajmniej następujące walidacje przed Apply:
- `sourceId` jest unikalny w `issue-seed.json`.
- `title` issue zaczyna się od `TB-\d+` (np. `TB-123: Krótki tytuł`).
- Przypisany `milestone` istnieje w `.github/gh-sync.json` (lub na repozytorium).
- Brak duplikatów (title + milestone) lub dokładnych kopii issue.

Przykład walidacji w PowerShell (unikalność `sourceId` i tytuł):

```powershell
$data = Get-Content .github/issue-seed.json -Raw | ConvertFrom-Json
# powtórzone sourceId
$dups = $data | Group-Object -Property sourceId | Where-Object { $_.Count -gt 1 }
if ($dups) { Write-Error "Znaleziono zduplikowane sourceId:"; $dups | ForEach-Object { $_.Name; $_.Count } }
# tytuły bez wzorca
$badTitles = $data | Where-Object { -not ($_ .title -match '^TB-\d+') }
if ($badTitles) { Write-Error "Znaleziono tytuły niezgodne z wzorcem TB-\d+:"; $badTitles | Select-Object title }
```

Checklist przed Apply (krótko)
------------------------------
- [ ] `gh-sync.json` i `issue-seed.json` są poprawne (UTF-8).
- [ ] Uruchomiony dry-run obu skryptów i sprawdzone raporty.
- [ ] Zrobiony backup REST issues+milestones (backup/).
- [ ] Walidacje (unique `sourceId`, tytuły `TB-\d+`, istniejące milestone'y) przeszły pomyślnie.

Sugestia CI
-----------
Zalecane: GitHub Action uruchamiający na `push`:
- wykona `sync-github-meta.ps1` i `seed-github-issues.ps1` w trybie dry-run,
- sprawdzi encoding plików (`gh-sync.json`, `issue-seed.json`) i brak powtórzeń `sourceId`,
- raportuje błędy jako check na PR.

Opis przykładowej implementacji Action (krótko):
- Trigger: `push` + `pull_request`.
- Kroki: checkout, sprawdź encoding (powershell snippet), uruchom skrypty bez `-Apply` i zapisz raporty jako artefakty lub komentarz PR.

Uwagi/założenia
---------------
- Zakładam, że skrypty `sync-github-meta.ps1` i `seed-github-issues.ps1` są wywoływalne z katalogu repozytorium (ścieżki pokazane powyżej). Jeśli znajdują się w innym katalogu, dostosuj ścieżki do lokalizacji skryptów.

Krótkie podsumowanie
--------------------
Ten dokument opisuje co edytować, w jakiej kolejności uruchamiać skrypty, jak sprawdzać encoding, robić backupy i co walidować przed Apply. Przed Apply wykonaj checklistę i upewnij się, że backup istnieje.
