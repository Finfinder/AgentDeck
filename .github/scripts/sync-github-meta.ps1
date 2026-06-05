[CmdletBinding()]
param(
    [switch]$Apply,
    [string]$ConfigPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'gh-sync.json')
)

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$mode = if ($Apply) { 'apply' } else { 'dry-run' }

function Write-Log {
    param([string]$Message)

    Write-Host "[sync-github-meta] $Message"
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

function Invoke-Step {
    param(
        [string]$Message,
        [scriptblock]$Action
    )

    if ($Apply) {
        Write-Log "APPLY: $Message"
        & $Action
        return
    }

    Write-Log "DRY-RUN: $Message"
}

function Get-SyncConfig {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        throw "Config file not found: $Path"
    }

    $config = Read-Utf8TextFile -Path $Path | ConvertFrom-Json -Depth 100
    if (-not $config.repo.slug) {
        throw "Missing repo.slug field in $Path"
    }
    if (-not $config.features) {
        throw "Missing features section in $Path"
    }
    if (-not $config.labels) {
        throw "Missing labels section in $Path"
    }
    if (-not $config.roadmapIssue) {
        throw "Missing roadmapIssue section in $Path"
    }

    return $config
}

function Get-ExistingLabels {
    param([string]$Slug)

    $labels = Invoke-GhJson @('api', "repos/$Slug/labels?per_page=100")
    $map = @{}
    if ($labels) {
        foreach ($label in $labels) {
            $map[[string]$label.name] = $label
        }
    }

    return $map
}

function Sync-Features {
    param($Config)

    $values = @{
        has_issues = [bool]$Config.features.issues
        has_projects = [bool]$Config.features.projects
        has_wiki = [bool]$Config.features.wiki
        has_discussions = [bool]$Config.features.discussions
    }

    $requestParts = @('api', '--method', 'PATCH', "repos/$($Config.repo.slug)")
    foreach ($key in $values.Keys) {
        $requestParts += @('-f', "$key=$([string]$values[$key].ToString().ToLowerInvariant())")
    }

    Invoke-Step "sync repository settings" { Invoke-GhText -Arguments $requestParts | Out-Null }
}

function Sync-Labels {
    param($Config)

    $existingLabels = Get-ExistingLabels -Slug $Config.repo.slug

    foreach ($label in $Config.labels) {
        $name = [string]$label.name
        $color = [string]$label.color
        $description = [string]$label.description

        if ([string]::IsNullOrWhiteSpace($name) -or [string]::IsNullOrWhiteSpace($color)) {
            throw "Each label must have name and color."
        }

        if ($existingLabels.ContainsKey($name)) {
            $encodedName = [uri]::EscapeDataString($name)
            $payload = [pscustomobject]@{
                new_name = $name
                color = $color
                description = $description
            }
            Invoke-Step "update label '$name'" {
                Invoke-GhApiWithJsonPayload -Method 'PATCH' -Endpoint "repos/$($Config.repo.slug)/labels/$encodedName" -Payload $payload | Out-Null
            }
        }
        else {
            $payload = [pscustomobject]@{
                name = $name
                color = $color
                description = $description
            }
            Invoke-Step "create label '$name'" {
                Invoke-GhApiWithJsonPayload -Method 'POST' -Endpoint "repos/$($Config.repo.slug)/labels" -Payload $payload | Out-Null
            }
        }
    }
}

function Sync-Milestones {
    param($Config)

    if (-not ($Config.PSObject.Properties.Name -contains 'milestones')) {
        return
    }
    if (-not $Config.milestones) {
        return
    }

    $existingMilestones = Invoke-GhJson @('api', "repos/$($Config.repo.slug)/milestones?state=all&per_page=100")
    $existingByTitle = @{}
    if ($existingMilestones) {
        foreach ($milestone in $existingMilestones) {
            $existingByTitle[[string]$milestone.title] = $milestone
        }
    }

    foreach ($milestone in $Config.milestones) {
        $title = [string]$milestone.title
        if ([string]::IsNullOrWhiteSpace($title)) {
            continue
        }

        $description = [string]$milestone.description
        $state = if ([string]::IsNullOrWhiteSpace([string]$milestone.state)) { 'open' } else { [string]$milestone.state }
        $payload = [ordered]@{
            title = $title
            description = $description
            state = $state
        }

        if ($existingByTitle.ContainsKey($title)) {
            $number = [int]$existingByTitle[$title].number
            Invoke-Step "update milestone '$title'" {
                Invoke-GhApiWithJsonPayload -Method 'PATCH' -Endpoint "repos/$($Config.repo.slug)/milestones/$number" -Payload $payload | Out-Null
            }
        }
        else {
            Invoke-Step "create milestone '$title'" {
                Invoke-GhApiWithJsonPayload -Method 'POST' -Endpoint "repos/$($Config.repo.slug)/milestones" -Payload $payload | Out-Null
            }
        }
    }
}

function Find-IssueByTitle {
    param(
        [string]$Slug,
        [string]$Title
    )

    $issues = Invoke-GhJson @('issue', 'list', '--repo', $Slug, '--state', 'all', '--search', $Title, '--json', 'number,title,id,labels')
    if (-not $issues) {
        return $null
    }

    return $issues | Where-Object { $_.title -eq $Title } | Select-Object -First 1
}

function Sync-RoadmapIssue {
    param($Config)

    if (-not [bool]$Config.roadmapIssue.enabled) {
        return
    }

    $title = [string]$Config.roadmapIssue.title
    if ([string]::IsNullOrWhiteSpace($title)) {
        throw "roadmapIssue.title field is required when roadmapIssue.enabled = true."
    }

    $bodyRelativePath = [string]$Config.roadmapIssue.bodyPath
    $bodyPath = Join-Path $repoRoot $bodyRelativePath
    if (-not (Test-Path $bodyPath)) {
        throw "Roadmap body file not found: $bodyPath"
    }

    $labels = @()
    if ($Config.roadmapIssue.labels) {
        $labels = @($Config.roadmapIssue.labels | ForEach-Object { [string]$_ })
    }

    $existingIssue = Find-IssueByTitle -Slug $Config.repo.slug -Title $title
    if ($existingIssue) {
        $requestParts = @('issue', 'edit', [string]$existingIssue.number, '--repo', $Config.repo.slug, '--title', $title, '--body-file', $bodyPath)
        foreach ($label in $labels) {
            $requestParts += @('--add-label', $label)
        }
        Invoke-Step "update roadmap issue '$title'" { Invoke-GhText -Arguments $requestParts | Out-Null }
    }
    else {
        $requestParts = @('issue', 'create', '--repo', $Config.repo.slug, '--title', $title, '--body-file', $bodyPath)
        foreach ($label in $labels) {
            $requestParts += @('--label', $label)
        }
        Invoke-Step "create roadmap issue '$title'" { Invoke-GhText -Arguments $requestParts | Out-Null }
    }

    if (-not [bool]$Config.roadmapIssue.pin) {
        return
    }

    if (-not $Apply) {
        Write-Log "DRY-RUN: pin roadmap issue '$title'"
        return
    }

    $issueToPin = Find-IssueByTitle -Slug $Config.repo.slug -Title $title
    if (-not $issueToPin -or [string]::IsNullOrWhiteSpace([string]$issueToPin.id)) {
        throw "Failed to determine roadmap issue ID to pin."
    }

    try {
        Invoke-GhText -Arguments @(
            'api', 'graphql',
            '-f', 'query=mutation($issueId:ID!){pinIssue(input:{issueId:$issueId}){issue{id number}}}',
            '-f', "issueId=$([string]$issueToPin.id)"
        ) | Out-Null
        Write-Log "Pinned roadmap issue '$title'"
    }
    catch {
        Write-Log "Skipped pinning '$title': $($_.Exception.Message)"
    }
}

$config = Get-SyncConfig -Path $ConfigPath
Write-Log "Using config '$ConfigPath'"
Invoke-GhReadyCheck
Sync-Features -Config $config
Sync-Labels -Config $config
Sync-Milestones -Config $config
Sync-RoadmapIssue -Config $config
Write-Log "Completed in $mode mode."
if (-not $Apply) {
    Write-Log "Use -Apply to apply changes to the remote repository."
}