# Squash Commits Script
# Usage: .\squash-commits.ps1

# Step 1: Check for changes and commit if any
$status = git status --porcelain
if ($status) {
    Write-Host "Adding all changes..." -ForegroundColor Cyan
    git add .

    Write-Host "Creating temporary commit..." -ForegroundColor Cyan
    git commit -m "temp commit for squash/amend"

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Commit failed." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "No uncommitted changes, skipping add/commit step." -ForegroundColor Yellow
}

# Step 3: Show recent commits
Write-Host "`nRecent commits:" -ForegroundColor Green
git log --oneline -10

# Step 4: Ask how many commits to squash/amend
Write-Host ""
$count = Read-Host "How many commits do you want to squash? (Enter 1 to amend the last commit's message)"

if (-not ($count -match '^\d+$') -or [int]$count -lt 1) {
    Write-Host "Invalid number. Must be at least 1." -ForegroundColor Red
    exit 1
}

# Step 5: Ask for the new commit message
Write-Host ""
$message = Read-Host "Enter the new commit message"

if ([string]::IsNullOrWhiteSpace($message)) {
    Write-Host "Commit message cannot be empty." -ForegroundColor Red
    exit 1
}

# Step 6: Perform the action based on the count
if ([int]$count -eq 1) {
    Write-Host "`nAmending the last commit message..." -ForegroundColor Cyan
    git commit --amend -m "$message"

    if ($LASTEXITCODE -eq 0) {
        Write-Host "`nLast commit message amended successfully!" -ForegroundColor Green
        Write-Host "New commit:" -ForegroundColor Green
        git log --oneline -1
    } else {
        Write-Host "Amending commit message failed." -ForegroundColor Red
        exit 1
    }
} else { # $count is 2 or more, perform squash
    Write-Host "`nSquashing $count commits..." -ForegroundColor Cyan

    # Check total commit count
    $totalCommits = git rev-list --count HEAD

    if ([int]$count -gt [int]$totalCommits) {
        Write-Host "Error: Cannot squash $count commits. Repository only has $totalCommits commits." -ForegroundColor Red
        exit 1
    }

    if ([int]$count -eq [int]$totalCommits) {
        # Squashing all commits including root - need to use --root
        git reset --soft $(git rev-list --max-parents=0 HEAD)
        git commit --amend -m "$message"
    } else {
        # Soft reset to keep changes staged
        git reset --soft HEAD~$count
        git commit -m "$message"
    }

    if ($LASTEXITCODE -eq 0) {
        Write-Host "`nSquash completed successfully!" -ForegroundColor Green
        Write-Host "New commit:" -ForegroundColor Green
        git log --oneline -3
    } else {
        Write-Host "Squash failed." -ForegroundColor Red
        exit 1
    }
}