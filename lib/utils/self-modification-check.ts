import path from 'path'

export function isSelfModification(repoPath: string, currentWorkingDir: string = process.cwd()): boolean {
  // Normalize paths for comparison
  const normalizedRepoPath = path.resolve(repoPath)
  const normalizedCwd = path.resolve(currentWorkingDir)
  
  // Check if the repo path is the same as or a parent of the current working directory
  return normalizedCwd.startsWith(normalizedRepoPath)
}

export function getSelfModificationWarning(): string {
  return `WARNING: You are attempting to modify the Claude Task Manager's own codebase.

This could lead to:
- Changes not taking effect until the app is restarted
- Potential conflicts or corruption if critical files are modified
- Orphaned worktrees if the app crashes during modification

It's recommended to:
1. Use a different instance of the tool to modify this codebase
2. Or ensure you understand the risks and restart the app after modifications

Do you want to proceed anyway?`
}