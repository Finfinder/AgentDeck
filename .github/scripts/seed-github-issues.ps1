[CmdletBinding()]
param(
    [switch]$Apply,
    [string]$SeedPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'issue-seed.json'),
    [string]$Repo
)

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$mode = if ($Apply) { 'apply' } else { 'dry-run' }
$sourceIdPattern = 'AD-\d+'

function Write-Log {
    param([string]$Message)

    Write-Host "[seed-github-issues] $Message"
}

function Test-IsWindowsPlatform {
    return $env:OS -eq 'Windows_NT'
}

function Get-Utf8Encoding {
    return New-Object System.Text.UTF8Encoding($false)
}

function Read-Utf8TextFile {
    param([string]$Path)

    return [System.IO.File]::ReadAllText($Path, (Get-Utf8Encoding))
}

function Invoke-GhCommand {
    param([string[]]$Arguments)

    $shouldForceUtf8 = Test-IsWindowsPlatform
    $previousInputEncoding = $null
    $previousOutputEncoding = $null
    $previousPipelineEncoding = $null

    try {
        if ($shouldForceUtf8) {
            $utf8 = Get-Utf8Encoding
            $previousInputEncoding = [Console]::InputEncoding
            $previousOutputEncoding = [Console]::OutputEncoding
            $previousPipelineEncoding = $OutputEncoding

            [Console]::InputEncoding = $utf8
            [Console]::OutputEncoding = $utf8
            $OutputEncoding = $utf8
        }

        $output = & gh @Arguments 2>&1
        $exitCode = $LASTEXITCODE

        return [pscustomobject]@{
            ExitCode = $exitCode
            Output = (($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine).Trim()
        }
    }
    finally {
        if ($shouldForceUtf8) {
            if ($null -ne $previousInputEncoding) {
                [Console]::InputEncoding = $previousInputEncoding
            }
            if ($null -ne $previousOutputEncoding) {
                [Console]::OutputEncoding = $previousOutputEncoding
            }
            if ($null -ne $previousPipelineEncoding) {
                $OutputEncoding = $previousPipelineEncoding
            }
        }
    }
}

function Invoke-GhText {
    param([string[]]$Arguments)

    $result = Invoke-GhCommand -Arguments $Arguments
    if ($result.ExitCode -ne 0) {
        $rendered = [string]$result.Output
        throw "gh command failed: gh $($Arguments -join ' ')$([Environment]::NewLine)$rendered"
    }

    return [string]$result.Output
}

function Invoke-GhJson {
    param([string[]]$Arguments)

    $text = Invoke-GhText -Arguments $Arguments
    if ([string]::IsNullOrWhiteSpace($text)) {
        return $null
    }

    return $text | ConvertFrom-Json -Depth 100
}

function New-TemporaryJsonPayloadFile {
    param([object]$Payload)

    $path = Join-Path ([System.IO.Path]::GetTempPath()) "agentdeck-gh-$([guid]::NewGuid().ToString('N')).json"
    $json = $Payload | ConvertTo-Json -Depth 100
    [System.IO.File]::WriteAllText($path, $json, (Get-Utf8Encoding))

    return $path
}

function Invoke-GhApiWithJsonPayload {
    param(
        [string]$Method,
        [string]$Endpoint,
        [object]$Payload,
        [switch]$RawText
    )

    $inputPath = $null

    try {
        $inputPath = New-TemporaryJsonPayloadFile -Payload $Payload
        $text = Invoke-GhText -Arguments @('api', '--method', $Method, $Endpoint, '--input', $inputPath)

        if ($RawText) {
            return [string]$text
        }

        if ([string]::IsNullOrWhiteSpace($text)) {
            return $null
        }

        return $text | ConvertFrom-Json -Depth 100
    }
    finally {
        if ($inputPath -and (Test-Path -LiteralPath $inputPath)) {
            Remove-Item -LiteralPath $inputPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function Invoke-GhReadyCheck {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        throw "GitHub CLI ('gh') not found in PATH."
    }

    $versionCheck = Invoke-GhCommand -Arguments @('--version')
    if ($versionCheck.ExitCode -ne 0) {
        throw "Failed to run GitHub CLI ('gh')."
    }

    $authCheck = Invoke-GhCommand -Arguments @('auth', 'status')
    if ($authCheck.ExitCode -ne 0) {
        throw "GitHub CLI is not authenticated. Run 'gh auth login'."
    }
}

function Resolve-PathFromRepoRoot {
    param([string]$Path)

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return $Path
    }

    return Join-Path $repoRoot $Path
}

function Get-RepoConfig {
    $configPath = Join-Path $repoRoot '.github/gh-sync.json'
    if (-not (Test-Path $configPath)) {
        throw "Repo config not found: $configPath"
    }

    $config = Read-Utf8TextFile -Path $configPath | ConvertFrom-Json -Depth 100
    if (-not $config.repo.slug) {
        throw "Missing repo.slug field in $configPath"
    }
    if (-not $config.labels) {
        throw "Missing labels section in $configPath"
    }
    if (-not $config.milestones) {
        throw "Missing milestones section in $configPath"
    }

    return $config
}

function Get-NormalizedSourceIds {
    param([string[]]$SourceIds)

    $normalizedSourceIds = @(
        $SourceIds |
            Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } |
            ForEach-Object { ([string]$_).Trim().ToUpperInvariant() } |
            Sort-Object -Unique
    )

    return ,$normalizedSourceIds
}

function Get-SourceIdKey {
    param([string[]]$SourceIds)

    return (Get-NormalizedSourceIds -SourceIds $SourceIds) -join '|'
}

function Get-TitleSourceId {
    param([string]$Title)

    $match = [regex]::Match($Title, '^(?<id>AD-\d+)\b', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $match.Success) {
        throw "Issue '$Title' must start with a backlog identifier in format 'AD-xx'."
    }

    return ([string]$match.Groups['id'].Value).Trim().ToUpperInvariant()
}

function Get-ConfiguredMilestoneTitles {
    param($RepoConfig)

    $titles = @()
    $seen = @{}

    foreach ($milestone in @($RepoConfig.milestones)) {
        $title = [string]$milestone.title
        if ([string]::IsNullOrWhiteSpace($title)) {
            throw "Each milestone in .github/gh-sync.json must have a title."
        }
        if ($seen.ContainsKey($title)) {
            throw "Duplicate milestone '$title' in .github/gh-sync.json."
        }

        $seen[$title] = $true
        $titles += $title
    }

    $configuredMilestoneTitles = @($titles | Sort-Object)

    return ,$configuredMilestoneTitles
}

function Get-SourceIdsFromBody {
    param([AllowNull()][string]$Body)

    if ([string]::IsNullOrWhiteSpace($Body)) {
        return ,@()
    }

    $match = [regex]::Match($Body, '(?im)^\s*Original backlog IDs:\s*(?<ids>.+?)\s*$')
    if (-not $match.Success) {
        return ,@()
    }

    $matches = [regex]::Matches($match.Groups['ids'].Value, $sourceIdPattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $matches -or $matches.Count -eq 0) {
        return ,@()
    }

    $sourceIds = Get-NormalizedSourceIds -SourceIds @($matches | ForEach-Object { $_.Value })

    return ,$sourceIds
}

function Get-SourceIdsFromTitle {
    param([string]$Title)

    $match = [regex]::Match($Title, $sourceIdPattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $match.Success) {
        return ,@()
    }

    return Get-NormalizedSourceIds -SourceIds @($match.Value)
}

function Get-IssueSeed {
    param(
        [string]$Path,
        [string[]]$AllowedLabels,
        [string[]]$AllowedMilestones
    )

    $resolvedPath = Resolve-PathFromRepoRoot -Path $Path
    if (-not (Test-Path $resolvedPath)) {
        throw "Seed file not found: $resolvedPath"
    }

    $seed = Read-Utf8TextFile -Path $resolvedPath | ConvertFrom-Json -Depth 100
    if (-not ($seed.PSObject.Properties.Name -contains 'issues')) {
        throw "Missing issues section in $resolvedPath"
    }
    if (-not $seed.issues -or $seed.issues.Count -eq 0) {
        throw "Seed file $resolvedPath contains no issues."
    }

    $seenTitles = @{}
    $seenSourceIdKeys = @{}

    foreach ($issue in $seed.issues) {
        $title = [string]$issue.title
        $body = [string]$issue.body
        $milestone = [string]$issue.milestone
        $labels = @($issue.labels | ForEach-Object { [string]$_ })
        $declaredSourceIds = Get-NormalizedSourceIds -SourceIds @($issue.sourceIds | ForEach-Object { [string]$_ })

        if ([string]::IsNullOrWhiteSpace($title)) {
            throw 'Each issue in seed must have a title.'
        }

        $titleSourceId = Get-TitleSourceId -Title $title

        if ([string]::IsNullOrWhiteSpace($body)) {
            throw "Issue '$title' has no body."
        }
        if ([string]::IsNullOrWhiteSpace($milestone)) {
            throw "Issue '$title' has no milestone."
        }
        if ($AllowedMilestones -notcontains $milestone) {
            throw "Issue '$title' uses milestone '$milestone', which is not defined in .github/gh-sync.json."
        }
        if (-not $labels -or $labels.Count -eq 0) {
            throw "Issue '$title' must have at least one label."
        }
        if (-not $declaredSourceIds -or $declaredSourceIds.Count -eq 0) {
            throw "Issue '$title' must have sourceIds with exactly one backlog identifier."
        }
        if ($declaredSourceIds.Count -ne 1) {
            throw "Issue '$title' must have exactly one sourceId matching the title identifier."
        }
        if ($declaredSourceIds[0] -ne $titleSourceId) {
            throw "Issue '$title' has sourceId '$($declaredSourceIds[0])', but title indicates '$titleSourceId'. Align the seed entry."
        }
        if ($seenTitles.ContainsKey($title)) {
            throw "Duplicate title '$title' in $resolvedPath."
        }

        $bodySourceIds = Get-SourceIdsFromBody -Body $body
        if ($bodySourceIds.Count -eq 0) {
            # If no "Original backlog IDs:" in body, derive from title
            $bodySourceIds = Get-SourceIdsFromTitle -Title $title
        }

        $sourceIdKey = Get-SourceIdKey -SourceIds $declaredSourceIds
        if ($sourceIdKey -ne (Get-SourceIdKey -SourceIds $bodySourceIds)) {
            throw "Issue '$title' has inconsistent sourceIds between sourceIds field and body."
        }
        if ($seenSourceIdKeys.ContainsKey($sourceIdKey)) {
            throw "Duplicate sourceIds '$sourceIdKey' in $resolvedPath."
        }

        foreach ($label in $labels) {
            if ($AllowedLabels -notcontains $label) {
                throw "Issue '$title' uses label '$label', which is not defined in .github/gh-sync.json."
            }
        }

        $seenTitles[$title] = $true
        $seenSourceIdKeys[$sourceIdKey] = $true
    }

    return [pscustomobject]@{
        Path = $resolvedPath
        Data = $seed
    }
}

function Get-ExistingIssueMaps {
    param([string]$Slug)

    $issues = Invoke-GhJson @('issue', 'list', '--repo', $Slug, '--state', 'all', '--limit', '500', '--json', 'number,title,body,labels,milestone')
    $titleMap = @{}
    $sourceIdMap = @{}
    if ($issues) {
        foreach ($issue in $issues) {
            $issueTitle = [string]$issue.title
            if ($titleMap.ContainsKey($issueTitle)) {
                $existingNumber = [string]$titleMap[$issueTitle].number
                throw "Duplicate remote title '$issueTitle' in #$existingNumber and #$([string]$issue.number) in '$Slug'. Remove the conflict before seeding."
            }

            $titleMap[$issueTitle] = $issue

            $sourceIdKey = Get-SourceIdKey -SourceIds (Get-SourceIdsFromBody -Body ([string]$issue.body))
            if (-not [string]::IsNullOrWhiteSpace($sourceIdKey)) {
                if ($sourceIdMap.ContainsKey($sourceIdKey)) {
                    $existingNumber = [string]$sourceIdMap[$sourceIdKey].number
                    throw "Duplicate remote sourceIds '$sourceIdKey' in #$existingNumber and #$([string]$issue.number) in '$Slug'. Remove the conflict before seeding."
                }

                $sourceIdMap[$sourceIdKey] = $issue
            }
        }
    }

    return [pscustomobject]@{
        ByTitle = $titleMap
        BySourceIds = $sourceIdMap
    }
}

function Get-ExistingMilestoneMap {
    param([string]$Slug)

    $milestones = Invoke-GhJson @('api', "repos/$Slug/milestones?state=all&per_page=100")
    $map = @{}
    if ($milestones) {
        foreach ($milestone in $milestones) {
            $map[[string]$milestone.title] = $milestone
        }
    }

    return $map
}

function Format-List {
    param([object[]]$Items)

    $rendered = @(
        $Items |
            ForEach-Object { [string]$_ } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )

    if ($rendered.Count -eq 0) {
        return 'none'
    }

    return ($rendered -join ', ')
}

function Get-LabelNamesFromIssue {
    param($Issue)

    if (-not $Issue -or -not $Issue.labels) {
        return ,@()
    }

    $labelNames = @($Issue.labels | ForEach-Object { [string]$_.name } | Sort-Object -Unique)

    return ,$labelNames
}

function Get-MilestoneTitleFromIssue {
    param($Issue)

    if (-not $Issue -or -not $Issue.milestone) {
        return ''
    }

    return [string]$Issue.milestone.title
}

function Set-IssueInMaps {
    param(
        $Maps,
        [int]$Number,
        [string]$Title,
        [string]$Body,
        [string]$Milestone,
        [string[]]$Labels,
        [string]$PreviousTitle,
        [string[]]$PreviousSourceIds
    )

    if (-not [string]::IsNullOrWhiteSpace($PreviousTitle) -and $Maps.ByTitle.ContainsKey($PreviousTitle)) {
        [void]$Maps.ByTitle.Remove($PreviousTitle)
    }

    $previousSourceIdKey = Get-SourceIdKey -SourceIds $PreviousSourceIds
    if (-not [string]::IsNullOrWhiteSpace($previousSourceIdKey) -and $Maps.BySourceIds.ContainsKey($previousSourceIdKey)) {
        if ([string]$Maps.BySourceIds[$previousSourceIdKey].number -eq [string]$Number) {
            [void]$Maps.BySourceIds.Remove($previousSourceIdKey)
        }
    }

    $issueSnapshot = [pscustomobject]@{
        number = $Number
        title = $Title
        body = $Body
        milestone = if ([string]::IsNullOrWhiteSpace($Milestone)) { $null } else { [pscustomobject]@{ title = $Milestone } }
        labels = @($Labels | ForEach-Object { [pscustomobject]@{ name = $_ } })
    }

    $Maps.ByTitle[$Title] = $issueSnapshot

    $sourceIdKey = Get-SourceIdKey -SourceIds (Get-SourceIdsFromBody -Body $Body)
    if (-not [string]::IsNullOrWhiteSpace($sourceIdKey)) {
        $Maps.BySourceIds[$sourceIdKey] = $issueSnapshot
    }
}

$repoConfig = Get-RepoConfig
$allowedLabels = @($repoConfig.labels | ForEach-Object { [string]$_.name } | Sort-Object -Unique)
$allowedMilestones = Get-ConfiguredMilestoneTitles -RepoConfig $repoConfig
$seed = Get-IssueSeed -Path $SeedPath -AllowedLabels $allowedLabels -AllowedMilestones $allowedMilestones
$repoSlug = if ([string]::IsNullOrWhiteSpace($Repo)) { [string]$repoConfig.repo.slug } else { $Repo }

Write-Log "Using seed '$($seed.Path)'"
Write-Log "Target repo '$repoSlug'"

Invoke-GhReadyCheck

$existingMilestones = Get-ExistingMilestoneMap -Slug $repoSlug
$missingMilestones = @(
    $seed.Data.issues |
        ForEach-Object { [string]$_.milestone } |
        Sort-Object -Unique |
        Where-Object { -not $existingMilestones.ContainsKey($_) }
)
if ($missingMilestones.Count -gt 0) {
    throw "Missing remote milestones in '$repoSlug': $(Format-List -Items $missingMilestones). First run 'scripts/sync-github-meta.ps1 -Apply'."
}

$existingIssues = Get-ExistingIssueMaps -Slug $repoSlug

foreach ($issue in $seed.Data.issues) {
    $title = [string]$issue.title
    $body = [string]$issue.body
    $milestone = [string]$issue.milestone
    $labels = @($issue.labels | ForEach-Object { [string]$_ })
    $sourceIds = Get-NormalizedSourceIds -SourceIds @($issue.sourceIds | ForEach-Object { [string]$_ })

    $sourceIdKey = Get-SourceIdKey -SourceIds $sourceIds
    $titleMatch = $null
    $sourceIdMatch = $null

    if ($existingIssues.ByTitle.ContainsKey($title)) {
        $titleMatch = $existingIssues.ByTitle[$title]
    }
    if (-not [string]::IsNullOrWhiteSpace($sourceIdKey) -and $existingIssues.BySourceIds.ContainsKey($sourceIdKey)) {
        $sourceIdMatch = $existingIssues.BySourceIds[$sourceIdKey]
    }

    if ($titleMatch -and $sourceIdMatch -and ([string]$titleMatch.number -ne [string]$sourceIdMatch.number)) {
        throw "Match conflict for '$title': exact title points to #$([string]$titleMatch.number), but sourceIds point to #$([string]$sourceIdMatch.number). Remove the conflict before seeding."
    }

    $matchedIssue = $null
    $matchReason = $null

    if ($titleMatch -and $sourceIdMatch) {
        $matchedIssue = $titleMatch
        $matchReason = 'exact title + sourceIds'
    }
    elseif ($titleMatch) {
        $matchedIssue = $titleMatch
        $matchReason = 'exact title'
    }
    elseif ($sourceIdMatch) {
        $matchedIssue = $sourceIdMatch
        $matchReason = 'sourceIds'
    }

    if ($matchedIssue) {
        $existingNumber = [string]$matchedIssue.number
        $existingLabels = Get-LabelNamesFromIssue -Issue $matchedIssue
        $existingMilestone = Get-MilestoneTitleFromIssue -Issue $matchedIssue
        $labelsToAdd = @($labels | Where-Object { $existingLabels -notcontains $_ })
        $labelsToRemove = @($existingLabels | Where-Object { $labels -notcontains $_ })
        $hasNoChanges =
            ([string]$matchedIssue.title -ceq $title) -and
            ([string]$matchedIssue.body -ceq $body) -and
            ($existingMilestone -ceq $milestone) -and
            ($labelsToAdd.Count -eq 0) -and
            ($labelsToRemove.Count -eq 0)

        if ($hasNoChanges) {
            if ($Apply) {
                Write-Log "Skip / no changes for #$existingNumber via ${matchReason}: '$title'"
            }
            else {
                Write-Log "DRY-RUN: skip / no changes for #$existingNumber via ${matchReason}: '$title'"
            }

            continue
        }

        if (-not $Apply) {
            Write-Log "DRY-RUN: would update #$existingNumber via $matchReason to '$title' [milestone: $milestone] [add labels: $(Format-List -Items $labelsToAdd)] [remove labels: $(Format-List -Items $labelsToRemove)] [sourceIds: $(Format-List -Items $sourceIds)]"
            continue
        }

        $milestoneNumber = [int]$existingMilestones[$milestone].number
        $payload = [ordered]@{
            title = $title
            body = $body
            labels = @($labels)
            milestone = $milestoneNumber
        }

        $previousTitle = [string]$matchedIssue.title
        $previousSourceIds = Get-SourceIdsFromBody -Body ([string]$matchedIssue.body)
        Invoke-GhApiWithJsonPayload -Method 'PATCH' -Endpoint "repos/$repoSlug/issues/$existingNumber" -Payload $payload | Out-Null
        Set-IssueInMaps -Maps $existingIssues -Number ([int]$matchedIssue.number) -Title $title -Body $body -Milestone $milestone -Labels $labels -PreviousTitle $previousTitle -PreviousSourceIds $previousSourceIds
        Write-Log "Updated issue #$existingNumber via ${matchReason}: '$title'"
        continue
    }

    if (-not $Apply) {
        Write-Log "DRY-RUN: would create '$title' [milestone: $milestone] [labels: $(Format-List -Items $labels)] [sourceIds: $(Format-List -Items $sourceIds)]"
        continue
    }

    $milestoneNumber = [int]$existingMilestones[$milestone].number
    $payload = [ordered]@{
        title = $title
        body = $body
        labels = @($labels)
        milestone = $milestoneNumber
    }

    $createdIssue = Invoke-GhApiWithJsonPayload -Method 'POST' -Endpoint "repos/$repoSlug/issues" -Payload $payload
    if ($createdIssue -and $createdIssue.number) {
        Set-IssueInMaps -Maps $existingIssues -Number ([int]$createdIssue.number) -Title $title -Body $body -Milestone $milestone -Labels $labels -PreviousTitle '' -PreviousSourceIds @()
    }

    Write-Log "Created issue '$title'"
}

Write-Log "Completed in $mode mode."
if (-not $Apply) {
    Write-Log 'Use -Apply to create or update issues after syncing repo metadata.'
}