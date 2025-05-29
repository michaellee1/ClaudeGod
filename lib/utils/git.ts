import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import fs from 'fs/promises'
import { mergeConflictResolver } from './merge-conflict-resolver'
import { Task } from '../types/task'

const execFileAsync = promisify(execFile)

export async function validateGitRepo(repoPath: string): Promise<boolean> {
  try {
    await fs.access(repoPath)
    await execFileAsync('git', ['-C', repoPath, 'rev-parse', '--git-dir'])
    return true
  } catch {
    return false
  }
}

export async function createWorktree(repoPath: string, branchName: string): Promise<string> {
  // Validate repo first
  const isValid = await validateGitRepo(repoPath)
  if (!isValid) {
    throw new Error(`Invalid git repository: ${repoPath}`)
  }
  
  // Sanitize branch name
  const safeBranchName = branchName.replace(/[^a-zA-Z0-9-_]/g, '')
  
  // Create worktree in system temp directory
  const tempDir = os.tmpdir()
  const worktreeBase = path.join(tempDir, 'claude-god-worktrees')
  
  // Ensure the base directory exists
  await fs.mkdir(worktreeBase, { recursive: true })
  
  const worktreePath = path.join(worktreeBase, safeBranchName)
  
  try {
    // First fetch the latest changes to ensure we're up to date
    await execFileAsync('git', ['-C', repoPath, 'fetch', '--all'])
    
    // Get the current branch name
    const { stdout: currentBranch } = await execFileAsync('git', [
      '-C', repoPath,
      'rev-parse', '--abbrev-ref', 'HEAD'
    ])
    
    // Use execFile to prevent shell injection
    await execFileAsync('git', [
      '-C', repoPath,
      'worktree', 'add',
      worktreePath,
      '-b', safeBranchName,
      currentBranch.trim() // Branch from current branch
    ])
    
    // If this is self-modification, ensure package dependencies are available
    const packageJsonPath = path.join(worktreePath, 'package.json')
    try {
      await fs.access(packageJsonPath)
      // Copy node_modules symlink for faster startup (if it exists)
      const sourceModules = path.join(repoPath, 'node_modules')
      const targetModules = path.join(worktreePath, 'node_modules')
      try {
        await fs.access(sourceModules)
        await execFileAsync('ln', ['-s', sourceModules, targetModules])
      } catch {
        // node_modules doesn't exist or can't create symlink, that's ok
      }
    } catch {
      // No package.json, not a Node.js project
    }
    
    return worktreePath
  } catch (error) {
    console.error('Error creating worktree:', error)
    // Try to clean up if it partially created
    try {
      await fs.rmdir(worktreePath, { recursive: true })
    } catch {}
    throw error
  }
}

export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  try {
    // First remove the git worktree
    await execFileAsync('git', [
      '-C', repoPath,
      'worktree', 'remove',
      worktreePath,
      '--force'
    ])
    
    // Then remove the branch
    const branchName = path.basename(worktreePath)
    try {
      await execFileAsync('git', [
        '-C', repoPath,
        'branch', '-D',
        branchName
      ])
    } catch {
      // Branch might not exist or be checked out elsewhere
    }
  } catch (error) {
    console.error('Error removing worktree:', error)
    throw error
  }
}

export async function commitChanges(worktreePath: string, message: string): Promise<string> {
  try {
    // Check if there are any changes to commit
    const { stdout: status } = await execFileAsync('git', ['-C', worktreePath, 'status', '--porcelain'])
    
    if (!status.trim()) {
      // No changes to commit - create an empty commit
      console.log('No changes detected, creating empty commit')
      const safeMessage = message.replace(/"/g, '\\"').substring(0, 1000)
      await execFileAsync('git', ['-C', worktreePath, 'commit', '--allow-empty', '-m', safeMessage])
    } else {
      // Sanitize commit message
      const safeMessage = message.replace(/"/g, '\\"').substring(0, 1000)
      
      await execFileAsync('git', ['-C', worktreePath, 'add', '.'])
      await execFileAsync('git', ['-C', worktreePath, 'commit', '-m', safeMessage])
    }
    
    // Get the commit hash
    const { stdout } = await execFileAsync('git', ['-C', worktreePath, 'rev-parse', 'HEAD'])
    return stdout.trim()
  } catch (error) {
    console.error('Error committing changes:', error)
    throw error
  }
}

export async function cherryPickCommit(repoPath: string, commitHash: string): Promise<void> {
  try {
    // Cherry-pick the commit
    await execFileAsync('git', ['-C', repoPath, 'cherry-pick', commitHash])
  } catch (error: any) {
    console.error('Error cherry-picking commit:', error)
    
    // Check if this is a conflict error
    if (error.message?.includes('CONFLICT') || error.stderr?.includes('CONFLICT')) {
      // Get the branch name for the commit
      try {
        const { stdout: branches } = await execFileAsync('git', [
          '-C', repoPath,
          'branch', '--contains', commitHash, '--format=%(refname:short)'
        ])
        const branchName = branches.split('\n').filter(b => b.trim())[0] || commitHash.substring(0, 7)
        
        // Abort the cherry-pick to clean up
        await execFileAsync('git', ['-C', repoPath, 'cherry-pick', '--abort'])
        
        // Throw a special error that can be caught by the UI
        throw new Error(`CHERRY_PICK_CONFLICT:${branchName}`)
      } catch (abortError: any) {
        // If we can't get branch name or abort, throw with commit hash
        if (!abortError.message?.startsWith('CHERRY_PICK_CONFLICT:')) {
          await execFileAsync('git', ['-C', repoPath, 'cherry-pick', '--abort']).catch(() => {})
          throw new Error(`CHERRY_PICK_CONFLICT:${commitHash.substring(0, 7)}`)
        }
        throw abortError
      }
    }
    
    // For other errors, check if there are unmerged paths and abort if needed
    try {
      const { stdout: status } = await execFileAsync('git', ['-C', repoPath, 'status', '--porcelain'])
      if (status.includes('UU') || status.includes('AA') || status.includes('DD')) {
        // There are unmerged paths, abort the cherry-pick
        await execFileAsync('git', ['-C', repoPath, 'cherry-pick', '--abort'])
      }
    } catch (cleanupError) {
      console.error('Failed to cleanup cherry-pick state:', cleanupError)
    }
    
    throw new Error(`Cherry-pick failed: ${error.message || 'Unknown error during cherry-pick'}`)
  }
}

export async function undoCherryPick(repoPath: string): Promise<void> {
  try {
    // Reset to the previous commit, keeping changes in working directory
    await execFileAsync('git', ['-C', repoPath, 'reset', '--hard', 'HEAD~1'])
  } catch (error) {
    console.error('Error undoing cherry-pick:', error)
    throw error
  }
}

export async function getLastCommitHash(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])
    return stdout.trim()
  } catch (error) {
    console.error('Error getting last commit hash:', error)
    throw error
  }
}

// Safe branch name pattern - alphanumeric, hyphens, underscores, max 63 chars
const SAFE_BRANCH_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]{0,62}$/

function validateBranchName(branchName: string): void {
  if (!SAFE_BRANCH_PATTERN.test(branchName)) {
    throw new Error(`Invalid branch name format: ${branchName}`)
  }
}

export async function mergeWorktreeToMain(repoPath: string, worktreePath: string, task?: Task): Promise<void> {
  let cleanBranchName = ''
  let originalBranch = ''
  let tempBranchCreated = false
  
  try {
    // Check if the main repository has uncommitted changes
    const { stdout: status } = await execFileAsync('git', ['-C', repoPath, 'status', '--porcelain'])
    
    if (status.trim()) {
      throw new Error('UNCOMMITTED_CHANGES: The main repository has uncommitted changes. Please commit or stash them before merging.')
    }
    
    // Get the current branch name from the worktree
    const { stdout: branchName } = await execFileAsync('git', ['-C', worktreePath, 'branch', '--show-current'])
    cleanBranchName = branchName.trim()
    
    // Validate branch name BEFORE using it anywhere to prevent command injection
    validateBranchName(cleanBranchName)
    
    // Store the current branch in main repo to restore later
    try {
      const { stdout: currentBranch } = await execFileAsync('git', ['-C', repoPath, 'branch', '--show-current'])
      originalBranch = currentBranch.trim()
    } catch (error) {
      console.warn('Could not determine current branch, will not restore')
    }
    
    // First, ensure the worktree is up to date
    await execFileAsync('git', ['-C', worktreePath, 'add', '.'])
    try {
      await execFileAsync('git', ['-C', worktreePath, 'commit', '-m', 'Auto-commit before merge'])
    } catch (e) {
      // No changes to commit, that's fine
    }
    
    // Switch to main branch in the main repository
    await execFileAsync('git', ['-C', repoPath, 'checkout', 'main'])
    
    // Pull latest changes to ensure we're up to date
    try {
      await execFileAsync('git', ['-C', repoPath, 'pull'])
    } catch (pullError) {
      console.warn('Failed to pull latest changes, continuing with merge attempt')
    }
    
    // Push the worktree branch changes first
    await execFileAsync('git', ['-C', worktreePath, 'push', '-f', repoPath, `${cleanBranchName}:refs/heads/temp-${cleanBranchName}`])
    tempBranchCreated = true
    
    // Now merge the temporary branch with --no-ff to ensure a merge commit
    await execFileAsync('git', ['-C', repoPath, 'merge', '--no-ff', `temp-${cleanBranchName}`, '-m', `Merge branch '${cleanBranchName}'`])
    
    // Clean up the temporary branch
    await execFileAsync('git', ['-C', repoPath, 'branch', '-D', `temp-${cleanBranchName}`])
    tempBranchCreated = false
    
    console.log(`Successfully merged ${cleanBranchName} into main. Push manually when ready with: git push origin main`)
  } catch (error: any) {
    console.error('Error merging worktree to main:', error)
    
    // Clean up temporary branch if it was created
    if (tempBranchCreated) {
      try {
        await execFileAsync('git', ['-C', repoPath, 'branch', '-D', `temp-${cleanBranchName}`])
      } catch (cleanupError) {
        console.error('Failed to clean up temporary branch:', cleanupError)
      }
    }
    
    // Check if this is a merge conflict
    if (error.message && error.message.includes('CONFLICT')) {
      // If we have task context and Claude Code is available, try to resolve automatically
      if (task && process.env.CLAUDE_CODE_AUTO_RESOLVE_CONFLICTS !== 'false') {
        console.log('[git] Merge conflict detected, attempting automatic resolution with Claude Code')
        
        try {
          // Get conflicted files before attempting resolution
          const { stdout: conflictStatus } = await execFileAsync('git', [
            '-C', repoPath,
            'diff', '--name-only', '--diff-filter=U'
          ])
          const conflictFiles = conflictStatus.trim().split('\n').filter(f => f)
          
          await mergeConflictResolver.resolveConflicts({
            task,
            worktreePath,
            repoPath,
            branchName: cleanBranchName,
            taskPrompt: task.prompt,
            conflictFiles
          })
          
          console.log('[git] Conflicts resolved successfully with Claude Code')
          return // Success!
        } catch (resolveError: any) {
          console.error('[git] Failed to auto-resolve conflicts:', resolveError)
          
          // Abort the merge to clean up
          try {
            await execFileAsync('git', ['-C', repoPath, 'merge', '--abort'])
          } catch (abortError) {
            console.error('Failed to abort merge:', abortError)
          }
          
          // Re-throw with more context
          throw new Error(`MERGE_CONFLICT_UNRESOLVED:${cleanBranchName}:${resolveError.message}`)
        }
      } else {
        // No auto-resolution, abort and report conflict
        try {
          await execFileAsync('git', ['-C', repoPath, 'merge', '--abort'])
        } catch (abortError) {
          console.error('Failed to abort merge:', abortError)
        }
        throw new Error(`MERGE_CONFLICT:${cleanBranchName}`)
      }
    }
    
    // For other git errors, try to abort merge if in progress
    try {
      const { stdout: status } = await execFileAsync('git', ['-C', repoPath, 'status', '--porcelain'])
      if (status.includes('UU') || status.includes('AA') || status.includes('DD')) {
        // There are unmerged paths, abort the merge
        await execFileAsync('git', ['-C', repoPath, 'merge', '--abort'])
      }
    } catch (cleanupError) {
      console.error('Failed to cleanup merge state:', cleanupError)
    }
    
    throw new Error(`Merge failed: ${error.message || 'Unknown error during merge'}`)
  } finally {
    // Always try to restore original branch if we know what it was
    if (originalBranch && originalBranch !== 'main') {
      try {
        await execFileAsync('git', ['-C', repoPath, 'checkout', originalBranch])
      } catch (restoreError) {
        console.warn(`Could not restore branch ${originalBranch}:`, restoreError)
      }
    }
  }
}

export async function rebaseWorktreeOnMain(repoPath: string, worktreePath: string): Promise<void> {
  try {
    // Fetch latest changes directly in the worktree without switching branches in main repo
    await execFileAsync('git', ['-C', worktreePath, 'fetch', 'origin'])
    
    // Get the latest main branch commits
    await execFileAsync('git', ['-C', worktreePath, 'fetch', 'origin', 'main:refs/remotes/origin/main'])
    
    // In the worktree, rebase on the updated main
    await execFileAsync('git', ['-C', worktreePath, 'rebase', 'origin/main'])
  } catch (error: any) {
    console.error('Error rebasing worktree on main:', error)
    
    // If rebase conflicts, abort and provide helpful message
    if (error.message && (error.message.includes('CONFLICT') || error.message.includes('rebase'))) {
      try {
        await execFileAsync('git', ['-C', worktreePath, 'rebase', '--abort'])
      } catch (abortError) {
        console.error('Failed to abort rebase:', abortError)
      }
      throw new Error('Rebase conflicts detected. This worktree has changes that conflict with the latest main branch. Consider creating a new task instead.')
    }
    
    throw new Error(`Failed to update worktree: ${error.message || 'Unknown error during rebase'}`)
  }
}

export async function getTaskDiff(worktreePath: string, baseBranch: string = 'main'): Promise<string> {
  try {
    // Validate the worktree exists
    await fs.access(worktreePath)
    
    // Validate it's a git repository
    const isValid = await validateGitRepo(worktreePath)
    if (!isValid) {
      throw new Error(`Invalid git repository: ${worktreePath}`)
    }
    
    // Get the diff between the worktree and the base branch
    const { stdout: diff } = await execFileAsync('git', [
      '-C', worktreePath,
      'diff',
      `origin/${baseBranch}...HEAD`
    ])
    
    return diff
  } catch (error: any) {
    console.error('Error getting task diff:', error)
    
    // If the base branch doesn't exist remotely, try without origin/
    if (error.message && error.message.includes('unknown revision')) {
      try {
        const { stdout: diff } = await execFileAsync('git', [
          '-C', worktreePath,
          'diff',
          `${baseBranch}...HEAD`
        ])
        return diff
      } catch (fallbackError) {
        console.error('Error getting task diff with fallback:', fallbackError)
        throw new Error(`Failed to generate diff: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}`)
      }
    }
    
    throw new Error(`Failed to generate diff: ${error.message || 'Unknown error'}`)
  }
}