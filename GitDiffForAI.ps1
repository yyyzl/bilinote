# 交互式发布脚本 (不生成文件版)
# 用法: 
#   .\GitDiffForAI.ps1           (运行后根据提示选择模式)

<#
.SYNOPSIS
    交互式 Git 差异生成工具 (AI 专用版 - 无文件生成版)
.DESCRIPTION
    将 Git Diff 直接复制到剪贴板，不生成中间文件。
#>

# 强制控制台输出使用 UTF-8，防止中文乱码
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

# 1. 环境检查
if (-not (Test-Path ".git")) {
    Write-Host "错误: 当前目录不是一个 Git 仓库。" -ForegroundColor Red
    exit
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "错误: 未安装 Git。" -ForegroundColor Red
    exit
}

function Get-GitLog {
    # 获取最近 20 条提交
    $logOutput = git log --pretty=format:"%h|%s|%cr" -n 20
    $commits = @()
    $index = 1
    
    foreach ($line in $logOutput) {
        $parts = $line -split "\|"
        if ($parts.Count -ge 3) {
            $commits += [PSCustomObject]@{
                ID = $index; Hash = $parts[0]; Message = $parts[1]; Time = $parts[2]
            }
            $index++
        }
    }
    return $commits
}

Clear-Host
Write-Host "=== Git 差异生成工具 (AI Context 版) ===" -ForegroundColor Cyan

# 2. 获取并展示列表
try {
    $commitList = Get-GitLog
} catch {
    Write-Host "获取日志失败: $_" -ForegroundColor Red; exit
}

Write-Host "`n可用版本列表:" -ForegroundColor Yellow
Write-Host "------------------------------------------------------------"
"{0,-4} {1,-10} {2,-20} {3}" -f "序号", "Hash", "时间", "提交信息"
Write-Host "------------------------------------------------------------"
foreach ($item in $commitList) {
    $msg = if ($item.Message.Length -gt 50) { $item.Message.Substring(0, 47) + "..." } else { $item.Message }
    "{0,-4} {1,-10} {2,-20} {3}" -f $item.ID, $item.Hash, $item.Time, $msg
}
Write-Host "------------------------------------------------------------`n"

# 3. 用户交互选择
$baseSelection = Read-Host "请选择 旧版本 (Base) 序号"
$baseCommit = $commitList | Where-Object { $_.ID -eq $baseSelection }
if (-not $baseCommit) { Write-Host "无效序号"; exit }
Write-Host "基准: [$($baseCommit.Hash)]" -ForegroundColor Green

$targetSelection = Read-Host "请选择 新版本 (Target) 序号"
$targetCommit = $commitList | Where-Object { $_.ID -eq $targetSelection }
if (-not $targetCommit) { Write-Host "无效序号"; exit }
Write-Host "目标: [$($targetCommit.Hash)]" -ForegroundColor Green

# 4. 直接生成并复制到剪贴板
Write-Host "`n正在生成 AI 上下文差异并复制到剪贴板..." -ForegroundColor Cyan

try {
    # 获取 Git Diff 原文
    $diffOutput = git diff $($baseCommit.Hash) $($targetCommit.Hash)
    
    if (-not $diffOutput) {
        Write-Host "未检测到差异 (No changes detected)。" -ForegroundColor Yellow
        exit
    }

    # --- 构造给 AI 看的 Prompt (使用数组拼接) ---
    $headerLines = @(
        "Below is a Git Diff representing code changes between two versions of a project.",
        "Please analyze these changes.",
        "",
        "Metadata for Context:",
        "- Old Version (Base):   Hash: $($baseCommit.Hash) | Message: '$($baseCommit.Message)'",
        "- New Version (Target): Hash: $($targetCommit.Hash) | Message: '$($targetCommit.Message)'",
        "",
        "Format Description:",
        "- Lines starting with '-' were removed.",
        "- Lines starting with '+' were added.",
        "",
        "=== START OF GIT DIFF CONTENT ==="
    )
    $aiHeader = $headerLines -join "`r`n"

    $footerLines = @(
        "",
        "=== END OF GIT DIFF CONTENT ===",
        "",
        "Please focus your answer on the logic changes, potential bugs, or improvements based on the diff above."
    )
    $aiFooter = $footerLines -join "`r`n"

    # --- 直接组合内容并复制到剪贴板 (关键改动) ---
    $combinedContent = $aiHeader + "`r`n" + $diffOutput + "`r`n" + $aiFooter
    
    # 直接复制到剪贴板，不生成文件
    Set-Clipboard -Value $combinedContent

    Write-Host "成功! 内容已直接复制到剪贴板，直接去问 AI 吧！" -ForegroundColor Green
}
catch {
    Write-Host "发生错误: $_" -ForegroundColor Red
}

$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")