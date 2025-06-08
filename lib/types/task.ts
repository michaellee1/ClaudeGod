export interface Task {
  id: string
  prompt: string
  status: 'starting' | 'in_progress' | 'finished' | 'failed' | 'merged'
  phase: 'starting' | 'planning' | 'edit' | 'done'
  worktree: string
  repoPath: string
  createdAt: Date
  finishedAt?: Date
  mergedAt?: Date
  terminalTag: string
  mode?: 'planning' | 'edit'
  isSelfModification?: boolean
  commitHash?: string
  promptCycles?: PromptCycle[]
  previousTaskId?: string
  lastActivityTime?: Date
  requestedChangesAt?: Date
}

export interface PromptCycle {
  id: string
  prompt: string
  commitHash?: string
  requestedChanges?: string
  createdAt: Date
  finishedAt: Date
}

// Deprecated - kept for backward compatibility
export interface TaskOutput {
  id: string
  taskId: string
  type: string
  content: string
  timestamp: Date
}