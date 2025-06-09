export interface Task {
  id: string
  prompt: string
  worktree: string
  repoPath: string
  createdAt: Date
  terminalTag: string
  mode?: 'planning' | 'edit'
  isSelfModification?: boolean
  commitHash?: string
}


