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
    // Use execFile to prevent shell injection
    await execFileAsync('git', [
      '-C', repoPath,
      'worktree', 'add',
      worktreePath,
      '-b', safeBranchName
    ])
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

export async function commitChanges(worktreePath: string, message: string): Promise<void> {
  try {
    // Sanitize commit message
    const safeMessage = message.replace(/"/g, '\\"').substring(0, 1000)
    
    await execFileAsync('git', ['-C', worktreePath, 'add', '.'])
    await execFileAsync('git', ['-C', worktreePath, 'commit', '-m', safeMessage])
  } catch (error) {
    console.error('Error committing changes:', error)
    throw error
  }
}