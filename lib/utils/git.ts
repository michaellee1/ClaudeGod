import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import fs from 'fs/promises'
import { mergeConflictResolver } from './merge-conflict-resolver'
import { Task } from '../types/task'

const execFileAsync = promisify(execFile)

/**
 * Stages all changes including deletions.
 * This is a safer alternative to 'git add .' which doesn't stage deletions.
 */
export async function stageAllChanges(repoPath: string): Promise<void> {
  await execFileAsync('git', ['-C', repoPath, 'add', '-A'])
}

export async function validateGitRepo(repoPath: string): Promise<boolean> {
  try {
    // Check if path exists
    await fs.access(repoPath)
    
    // Check if it's a git repository
    await execFileAsync('git', ['-C', repoPath, 'rev-parse', '--git-dir'])
    
    return true
  } catch (error: any) {
    console.error('Git repo validation error:', {
      path: repoPath,
      error: error.message,
      code: error.code
    })
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
    // Check if the worktree exists first
    try {
      const { stdout: worktrees } = await execFileAsync('git', [
        '-C', repoPath,
        'worktree', 'list'
      ])
      
      // Only try to remove if the worktree is listed
      if (worktrees.includes(worktreePath)) {
        await execFileAsync('git', [
          '-C', repoPath,
          'worktree', 'remove',
          worktreePath,
          '--force'
        ])
      }
    } catch (error) {
      // If worktree list fails, log but continue
      console.warn('Could not list worktrees:', error)
    }
    
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
    
    // Finally, clean up the directory if it still exists
    try {
      const fs = await import('fs/promises')
      await fs.rm(worktreePath, { recursive: true, force: true })
    } catch {
      // Directory might not exist
    }
  } catch (error) {
    console.error('Error removing worktree:', error)
    // Don't throw - we want cleanup to be best effort
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
      
      await execFileAsync('git', ['-C', worktreePath, 'add', '-A'])
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

/**
 * Merges changes from a worktree back to the main branch.
 * 
 * This function ALWAYS rebases the worktree branch onto the latest main
 * before merging. This ensures that any changes made to main after the worktree
 * was created (including file deletions) are preserved and not overwritten.
 * 
 * If rebase conflicts occur, it will attempt to resolve them using Claude Code
 * if available, otherwise it will provide manual instructions.
 * 
 * @param repoPath - Path to the main repository
 * @param worktreePath - Path to the worktree
 * @param task - Optional task object for conflict resolution
 * @param onMergeConflictOutput - Optional callback for merge conflict output
 */
export async function mergeWorktreeToMain(
  repoPath: string, 
  worktreePath: string, 
  task?: Task, 
  onMergeConflictOutput?: (output: any) => void
): Promise<void> {
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
    await execFileAsync('git', ['-C', worktreePath, 'add', '-A'])
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
    console.log(`[mergeWorktreeToMain] Pushing ${cleanBranchName} to temp-${cleanBranchName}`)
    try {
      await execFileAsync('git', ['-C', worktreePath, 'push', '-f', repoPath, `${cleanBranchName}:refs/heads/temp-${cleanBranchName}`])
      tempBranchCreated = true
      console.log(`[mergeWorktreeToMain] Successfully created temp-${cleanBranchName}`)
    } catch (pushError: any) {
      console.error(`[mergeWorktreeToMain] Failed to push to temp branch:`, pushError)
      throw new Error(`Failed to create temporary branch for merge: ${pushError.message}`)
    }
    
    // Rebase the temp branch onto main to ensure it includes all latest changes
    // This is REQUIRED to prevent old file versions from being merged
    console.log(`[mergeWorktreeToMain] Rebasing temp-${cleanBranchName} onto main`)
    try {
      // First checkout the temp branch
      await execFileAsync('git', ['-C', repoPath, 'checkout', `temp-${cleanBranchName}`])
      
      // Rebase onto main
      await execFileAsync('git', ['-C', repoPath, 'rebase', 'main'])
      
      // Switch back to main for the merge
      await execFileAsync('git', ['-C', repoPath, 'checkout', 'main'])
      
      console.log(`[mergeWorktreeToMain] Successfully rebased temp-${cleanBranchName} onto main`)
    } catch (rebaseError: any) {
      console.error(`[mergeWorktreeToMain] Rebase failed:`, rebaseError)
      
      // Check if this is a conflict error
      const hasConflicts = rebaseError.stderr?.includes('CONFLICT') || 
                          rebaseError.message?.includes('CONFLICT') ||
                          rebaseError.stderr?.includes('could not apply')
      
      if (hasConflicts && task && onMergeConflictOutput) {
        console.log(`[mergeWorktreeToMain] Attempting to resolve rebase conflicts with Claude Code`)
        
        // Switch back to the temp branch to resolve conflicts
        await execFileAsync('git', ['-C', repoPath, 'checkout', `temp-${cleanBranchName}`])
        
        // Set the output callback if provided
        if (onMergeConflictOutput) {
          mergeConflictResolver.setOutputCallback(onMergeConflictOutput)
        }
        
        // Use merge conflict resolver for rebase conflicts
        try {
          await mergeConflictResolver.resolveConflicts({
            task,
            worktreePath,
            repoPath,
            branchName: cleanBranchName,
            taskPrompt: task.prompt || '',
            conflictFiles: [] // Will be populated by resolveConflicts
          })
          
          // Continue the rebase after conflicts are resolved
          await execFileAsync('git', ['-C', repoPath, 'rebase', '--continue'])
          await execFileAsync('git', ['-C', repoPath, 'checkout', 'main'])
          console.log(`[mergeWorktreeToMain] Successfully completed rebase after conflict resolution`)
        } catch (resolveError: any) {
          console.error(`[mergeWorktreeToMain] Failed to resolve conflicts or continue rebase:`, resolveError)
          await execFileAsync('git', ['-C', repoPath, 'rebase', '--abort'])
          await execFileAsync('git', ['-C', repoPath, 'checkout', 'main'])
          
          // Provide manual command for user
          const manualCommand = `cd '${repoPath}' && git checkout 'temp-${cleanBranchName}' && git rebase main`
          throw new Error(
            `Rebase conflicts could not be resolved automatically.\n` +
            `To manually resolve, run:\n${manualCommand}\n` +
            `Then complete the rebase and merge.`
          )
        }
      } else {
        // Non-conflict error or no conflict resolution available
        try {
          await execFileAsync('git', ['-C', repoPath, 'rebase', '--abort'])
        } catch (abortError) {
          console.error(`[mergeWorktreeToMain] Failed to abort rebase:`, abortError)
        }
        
        await execFileAsync('git', ['-C', repoPath, 'checkout', 'main'])
        
        throw new Error(
          `Rebase failed and cannot proceed with merge: ${rebaseError.message}\n` +
          `This prevents old file versions from being incorrectly merged.\n` +
          `Please ensure the task branch can be cleanly rebased onto main.`
        )
      }
    }
    
    // Verify the temporary branch exists before merging
    try {
      const { stdout: branches } = await execFileAsync('git', ['-C', repoPath, 'branch', '--list', `temp-${cleanBranchName}`])
      console.log(`[mergeWorktreeToMain] Branch list result:`, branches)
      if (!branches.trim()) {
        throw new Error(`Temporary branch temp-${cleanBranchName} was not created successfully`)
      }
      console.log(`[mergeWorktreeToMain] Verified temp-${cleanBranchName} exists`)
    } catch (verifyError: any) {
      console.error(`[mergeWorktreeToMain] Failed to verify temp branch:`, verifyError)
      throw new Error(`Failed to verify temporary branch: ${verifyError.message}`)
    }
    
    // Now merge the temporary branch with --no-ff to ensure a merge commit
    console.log(`[mergeWorktreeToMain] Merging temp-${cleanBranchName} into current branch`)
    try {
      await execFileAsync('git', ['-C', repoPath, 'merge', '--no-ff', `temp-${cleanBranchName}`, '-m', `Merge branch '${cleanBranchName}'`])
      console.log(`[mergeWorktreeToMain] Successfully merged temp-${cleanBranchName}`)
    } catch (mergeError: any) {
      console.error(`[mergeWorktreeToMain] Merge failed:`, mergeError)
      console.error(`[mergeWorktreeToMain] Error details:`, {
        stderr: mergeError.stderr,
        code: mergeError.code,
        command: mergeError.cmd
      })
      
      // If merge fails, provide a properly formatted command for manual execution
      // For shell safety, we'll use single quotes for the repo path and properly escape the merge message
      const shellEscapedRepoPath = repoPath.replace(/'/g, "'\\''")
      const shellEscapedBranchName = cleanBranchName.replace(/'/g, "'\\''")
      const manualCommand = `git -C '${shellEscapedRepoPath}' merge --no-ff 'temp-${shellEscapedBranchName}' -m 'Merge branch '"'"'${shellEscapedBranchName}'"'"''`
      
      // Include both the original error and the manual command
      const enhancedError = new Error(
        `Merge failed: ${mergeError.stderr || mergeError.message}\n` +
        `You can try running this command manually:\n${manualCommand}`
      )
      ;(enhancedError as any).originalError = mergeError
      throw enhancedError
    }
    
    // Clean up the temporary branch
    await execFileAsync('git', ['-C', repoPath, 'branch', '-D', `temp-${cleanBranchName}`])
    tempBranchCreated = false
    
    console.log(`Successfully merged ${cleanBranchName} into main. Push manually when ready with: git push origin main`)
  } catch (error: any) {
    console.error('Error merging worktree to main:', error)
    
    // Clean up temporary branch if it was created
    if (tempBranchCreated && cleanBranchName) {
      console.log(`[mergeWorktreeToMain] Cleaning up temporary branch temp-${cleanBranchName}`)
      try {
        await execFileAsync('git', ['-C', repoPath, 'branch', '-D', `temp-${cleanBranchName}`])
        console.log(`[mergeWorktreeToMain] Successfully cleaned up temp-${cleanBranchName}`)
      } catch (cleanupError) {
        console.error(`[mergeWorktreeToMain] Failed to clean up temporary branch temp-${cleanBranchName}:`, cleanupError)
        // Try force delete if normal delete fails
        try {
          await execFileAsync('git', ['-C', repoPath, 'branch', '-D', `temp-${cleanBranchName}`, '--force'])
        } catch (forceError) {
          console.error(`[mergeWorktreeToMain] Force delete also failed:`, forceError)
        }
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
          
          // Set up output callback if provided
          if (onMergeConflictOutput) {
            mergeConflictResolver.setOutputCallback(onMergeConflictOutput)
          }
          
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
    
    // Find the merge base between the current branch and the base branch
    // This ensures we only show changes made in this task, not inherited commits
    const { stdout: mergeBase } = await execFileAsync('git', [
      '-C', worktreePath,
      'merge-base',
      baseBranch,
      'HEAD'
    ])
    const mergeBaseCommit = mergeBase.trim()
    
    // Get the diff from the merge base to HEAD
    // This shows only the changes made in this task branch
    const { stdout: diff } = await execFileAsync('git', [
      '-C', worktreePath,
      'diff',
      `${mergeBaseCommit}...HEAD`
    ])
    
    return diff
  } catch (error: any) {
    console.error('Error getting task diff:', error)
    
    // Fallback: try a simple diff against the base branch
    try {
      const { stdout: diff } = await execFileAsync('git', [
        '-C', worktreePath,
        'diff',
        baseBranch
      ])
      return diff
    } catch (fallbackError) {
      console.error('Error getting task diff with fallback:', fallbackError)
      throw new Error(`Failed to generate diff: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}`)
    }
  }
}