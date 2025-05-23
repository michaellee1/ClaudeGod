import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'

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
    // Sanitize commit message
    const safeMessage = message.replace(/"/g, '\\"').substring(0, 1000)
    
    await execFileAsync('git', ['-C', worktreePath, 'add', '.'])
    await execFileAsync('git', ['-C', worktreePath, 'commit', '-m', safeMessage])
    
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
  } catch (error) {
    console.error('Error cherry-picking commit:', error)
    throw error
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

export async function mergeWorktreeToMain(repoPath: string, worktreePath: string): Promise<void> {
  try {
    // Get the current branch name from the worktree
    const { stdout: branchName } = await execFileAsync('git', ['-C', worktreePath, 'branch', '--show-current'])
    const cleanBranchName = branchName.trim()
    
    // Switch to main branch in the main repo
    await execFileAsync('git', ['-C', repoPath, 'checkout', 'main'])
    
    // Pull latest changes to avoid conflicts
    try {
      await execFileAsync('git', ['-C', repoPath, 'pull'])
    } catch (pullError) {
      console.warn('Failed to pull latest changes, continuing with merge attempt')
    }
    
    // Attempt to merge the worktree branch
    await execFileAsync('git', ['-C', repoPath, 'merge', cleanBranchName])
  } catch (error: any) {
    console.error('Error merging worktree to main:', error)
    
    // Check if this is a merge conflict
    if (error.message && error.message.includes('CONFLICT')) {
      // Abort the merge to clean up
      try {
        await execFileAsync('git', ['-C', repoPath, 'merge', '--abort'])
      } catch (abortError) {
        console.error('Failed to abort merge:', abortError)
      }
      throw new Error(`MERGE_CONFLICT:${cleanBranchName}`)
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
  }
}

export async function rebaseWorktreeOnMain(repoPath: string, worktreePath: string): Promise<void> {
  try {
    // Fetch latest changes in main repo
    await execFileAsync('git', ['-C', repoPath, 'fetch'])
    
    // Switch to main and pull latest
    await execFileAsync('git', ['-C', repoPath, 'checkout', 'main'])
    await execFileAsync('git', ['-C', repoPath, 'pull'])
    
    // In the worktree, rebase on the updated main
    await execFileAsync('git', ['-C', worktreePath, 'fetch', 'origin', 'main'])
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