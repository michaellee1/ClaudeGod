'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Task, TaskOutput } from '@/lib/types/task'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function TaskDetail() {
  const params = useParams()
  const router = useRouter()
  const [task, setTask] = useState<Task | null>(null)
  const [outputs, setOutputs] = useState<TaskOutput[]>([])
  const [isMerging, setIsMerging] = useState(false)
  const [showMergeConfirm, setShowMergeConfirm] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [additionalPrompt, setAdditionalPrompt] = useState('')
  const [isSendingPrompt, setIsSendingPrompt] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCommitting, setIsCommitting] = useState(false)
  const [showPreviewConflict, setShowPreviewConflict] = useState(false)
  const [conflictBranchName, setConflictBranchName] = useState<string | null>(null)
  const [showMergeConflict, setShowMergeConflict] = useState(false)
  const [mergeConflictBranchName, setMergeConflictBranchName] = useState<string | null>(null)
  const outputEndRef = useRef<HTMLDivElement>(null)
  const hasScrolledToBottom = useRef(false)
  const outputContainerRef = useRef<HTMLDivElement>(null)

  const taskId = params.id as string

  useEffect(() => {
    if (taskId) {
      fetchTask()
      fetchOutputs()
      const interval = setInterval(() => {
        fetchTask()
        fetchOutputs()
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [taskId])

  // Only scroll to bottom on initial load when outputs first appear
  useEffect(() => {
    if (outputs.length > 0 && !hasScrolledToBottom.current && outputContainerRef.current) {
      outputContainerRef.current.scrollTop = outputContainerRef.current.scrollHeight
      hasScrolledToBottom.current = true
    }
  }, [outputs.length > 0])

  const fetchTask = async () => {
    try {
      const response = await fetch(`/api/tasks/${taskId}`)
      if (response.ok) {
        const data = await response.json()
        setTask(data)
        // Sync preview state with task data
        if (data.isPreviewing !== undefined) {
          setIsPreviewing(data.isPreviewing)
        }
      }
    } catch (error) {
      console.error('Error fetching task:', error)
    }
  }

  const fetchOutputs = async () => {
    try {
      const response = await fetch(`/api/tasks/${taskId}/outputs`)
      if (response.ok) {
        const data = await response.json()
        setOutputs(data)
      }
    } catch (error) {
      console.error('Error fetching outputs:', error)
    }
  }

  const handleMerge = async () => {
    setIsMerging(true)
    try {
      const response = await fetch(`/api/tasks/${taskId}/merge`, {
        method: 'POST',
      })
      if (response.ok) {
        await fetchTask() // Refresh task to show merged status
        setError(null)
      } else {
        const errorData = await response.json()
        const errorMessage = errorData.error || 'Unknown error'
        if (errorMessage.startsWith('MERGE_CONFLICT:')) {
          const branchName = errorMessage.split(':')[1]
          setMergeConflictBranchName(branchName)
          setShowMergeConflict(true)
        } else {
          setError(`Failed to merge: ${errorMessage}`)
        }
      }
    } catch (error: any) {
      console.error('Error merging task:', error)
      setError(`Failed to merge task: ${error.message || 'Network error'}`)
    } finally {
      setIsMerging(false)
      setShowMergeConfirm(false)
    }
  }

  const handleRemove = async () => {
    if (!confirm('Are you sure you want to remove this task? This will delete the worktree and all changes.')) {
      return
    }
    
    setIsRemoving(true)
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        router.push('/')
      } else {
        const errorData = await response.json()
        setError(`Failed to remove: ${errorData.error || 'Unknown error'}`)
      }
    } catch (error: any) {
      console.error('Error removing task:', error)
      setError(`Failed to remove task: ${error.message || 'Network error'}`)
    } finally {
      setIsRemoving(false)
    }
  }

  const handleSendPrompt = async () => {
    if (!additionalPrompt.trim()) return
    
    setIsSendingPrompt(true)
    try {
      const response = await fetch(`/api/tasks/${taskId}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: additionalPrompt }),
      })
      if (response.ok) {
        setAdditionalPrompt('')
        setError(null)
      } else {
        const errorData = await response.json()
        setError(`Failed to send prompt: ${errorData.error || 'Unknown error'}`)
      }
    } catch (error: any) {
      console.error('Error sending prompt:', error)
      setError(`Failed to send prompt: ${error.message || 'Network error'}`)
    } finally {
      setIsSendingPrompt(false)
    }
  }

  const handleStartPreview = async () => {
    setIsPreviewing(true)
    setError(null)
    try {
      const response = await fetch(`/api/tasks/${taskId}/preview`, {
        method: 'POST',
      })
      if (!response.ok) {
        const errorData = await response.json()
        const errorMessage = errorData.error || 'Unknown error'
        
        // Check if this is a cherry-pick conflict
        if (errorMessage.startsWith('CHERRY_PICK_CONFLICT:')) {
          const branchName = errorMessage.split(':')[1]
          setConflictBranchName(branchName)
          setShowPreviewConflict(true)
          setIsPreviewing(false)
        } else {
          setError(`Failed to start preview: ${errorMessage}`)
          setIsPreviewing(false)
        }
      }
    } catch (error: any) {
      console.error('Error starting preview:', error)
      setError(`Failed to start preview: ${error.message || 'Network error'}`)
      setIsPreviewing(false)
    }
  }

  const handleStopPreview = async () => {
    setError(null)
    try {
      const response = await fetch(`/api/tasks/${taskId}/preview`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const errorData = await response.json()
        setError(`Failed to stop preview: ${errorData.error || 'Unknown error'}`)
      } else {
        setIsPreviewing(false)
      }
    } catch (error: any) {
      console.error('Error stopping preview:', error)
      setError(`Failed to stop preview: ${error.message || 'Network error'}`)
    }
  }

  const handleManualCommit = async () => {
    setIsCommitting(true)
    setError(null)
    try {
      const response = await fetch(`/api/tasks/${taskId}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `Complete task: ${task?.prompt}` }),
      })
      if (!response.ok) {
        const errorData = await response.json()
        setError(`Failed to commit: ${errorData.error || 'Unknown error'}`)
      } else {
        // Refresh task data to get the new commit hash
        await fetchTask()
      }
    } catch (error: any) {
      console.error('Error committing:', error)
      setError(`Failed to commit: ${error.message || 'Network error'}`)
    } finally {
      setIsCommitting(false)
    }
  }

  const handleResubmitTask = async () => {
    if (!task) return
    
    try {
      // Create a new task with the same prompt
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt: task.prompt,
          repoPath: task.repoPath
        }),
      })
      
      if (response.ok) {
        const newTask = await response.json()
        router.push(`/task/${newTask.id}`)
      } else {
        const errorData = await response.json()
        setError(`Failed to resubmit task: ${errorData.error || 'Unknown error'}`)
      }
    } catch (error: any) {
      console.error('Error resubmitting task:', error)
      setError(`Failed to resubmit task: ${error.message || 'Network error'}`)
    }
  }

  if (!task) {
    return (
      <div className="container mx-auto p-8">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">Loading...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col p-4">
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>
            <pre className="whitespace-pre-wrap font-sans">{error}</pre>
          </AlertDescription>
        </Alert>
      )}
      
      <div className="flex gap-4 h-full">
        {/* Left side - controls */}
        <div className="w-96 flex flex-col gap-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => router.push('/')}
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </Button>
                  <CardTitle className="text-lg">Task: {task.id}</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      task.status === 'starting' ? 'outline' :
                      task.status === 'in_progress' ? 'default' :
                      task.status === 'finished' ? 'success' :
                      task.status === 'interrupted' ? 'outline' :
                      task.status === 'merged' ? 'secondary' :
                      'destructive'
                    }
                  >
                    {task.status}
                  </Badge>
                  <Button
                    onClick={handleRemove}
                    disabled={isRemoving}
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </Button>
                </div>
              </div>
              <CardDescription className="text-xs mt-1">{task.prompt}</CardDescription>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              <Button
                onClick={() => setShowMergeConfirm(true)}
                disabled={isMerging || !task.commitHash || task.status === 'merged'}
                variant="default"
                className="w-full"
                size="sm"
              >
                {isMerging ? 'Merging...' : task.status === 'merged' ? 'Already Merged' : 'Merge to Main'}
              </Button>
              
              {task.commitHash && (
                <Button
                  onClick={isPreviewing ? handleStopPreview : handleStartPreview}
                  disabled={(task.status !== 'finished' && task.status !== 'merged') || isMerging}
                  variant={isPreviewing ? "destructive" : "secondary"}
                  className="w-full"
                  size="sm"
                >
                  {isPreviewing ? 'Stop Preview' : 'Preview Changes'}
                </Button>
              )}
              
              {task.status === 'finished' && !task.commitHash && (
                <Button
                  onClick={handleManualCommit}
                  disabled={isCommitting}
                  variant="secondary"
                  className="w-full"
                  size="sm"
                >
                  {isCommitting ? 'Committing...' : 'Commit Changes'}
                </Button>
              )}
            </CardContent>
          </Card>

          <Card className="flex-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Additional Prompt</CardTitle>
              {task.status !== 'finished' && (
                <p className="text-sm text-muted-foreground">
                  Available after task completion
                </p>
              )}
              {task.status === 'finished' && (
                <p className="text-sm text-muted-foreground">
                  Request additional changes to the completed task
                </p>
              )}
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Textarea
                  id="additionalPrompt"
                  value={additionalPrompt}
                  onChange={(e) => setAdditionalPrompt(e.target.value)}
                  className="min-h-[200px]"
                  placeholder={
                    task.status === 'finished' 
                      ? "Describe additional changes you'd like..."
                      : "Additional prompts available after completion..."
                  }
                  disabled={task.status !== 'finished'}
                />
                <Button
                  onClick={handleSendPrompt}
                  disabled={isSendingPrompt || task.status === 'finished' || task.status === 'merged' || !additionalPrompt.trim()}
                  className="w-full"
                  size="sm"
                >
                  {isSendingPrompt ? 'Sending...' : 'Send Additional Prompt'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right side - full height process output */}
        <div ref={outputContainerRef} className="flex-1 bg-gray-50 text-gray-900 p-4 rounded-lg overflow-y-auto font-mono text-sm border border-gray-200">
          {outputs.map((output) => {
            // Check if this is a tool use or file content
            const isToolUse = output.content.startsWith('[') && (output.content.includes('[Tool:') || output.content.includes('[Reading file:') || output.content.includes('[Editing file:') || output.content.includes('[Writing file:') || output.content.includes('[Searching') || output.content.includes('[Finding') || output.content.includes('[Running:') || output.content.includes('[Listing:') || output.content.includes('[Multi-editing') || output.content.includes('[System:'))
            const isFileContent = !isToolUse && output.content.includes('\n') && output.content.length > 100
            
            // Process content to handle escaped characters
            let displayContent = output.content
            
            // If it contains escaped newlines and tabs, unescape them
            if (displayContent.includes('\\n') || displayContent.includes('\\t')) {
              displayContent = displayContent
                .replace(/\\n/g, '\n')
                .replace(/\\t/g, '\t')
            }
            
            return (
              <div key={output.id} className="mb-4">
                <div className={`font-semibold ${
                  output.type === 'editor' ? 'text-green-700' : 'text-blue-700'
                }`}>
                  [{output.type.toUpperCase()}] {new Date(output.timestamp).toLocaleTimeString()}
                </div>
                {isToolUse ? (
                  <div className="text-gray-600 italic mt-1">{displayContent}</div>
                ) : isFileContent ? (
                  <pre className="whitespace-pre text-gray-600 leading-relaxed text-xs mt-1 font-mono overflow-x-auto bg-gray-100 p-2 rounded border border-gray-200">{displayContent}</pre>
                ) : (
                  <pre className="whitespace-pre-wrap text-gray-800 leading-relaxed mt-1">{displayContent}</pre>
                )}
              </div>
            )
          })}
          <div ref={outputEndRef} />
        </div>
      </div>

      {/* Merge Confirmation Dialog */}
      {showMergeConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-2">Merge to Main</h3>
            <p className="text-gray-600 mb-4">
              Are you sure you want to merge this task to the main branch? This will apply the changes permanently. The worktree will be preserved for reference.
            </p>
            <div className="flex justify-end space-x-2">
              <Button
                onClick={() => setShowMergeConfirm(false)}
                variant="outline"
                size="sm"
              >
                Cancel
              </Button>
              <Button
                onClick={handleMerge}
                variant="default"
                size="sm"
                disabled={isMerging}
              >
                {isMerging ? 'Merging...' : 'Merge'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Conflict Dialog */}
      {showPreviewConflict && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
            <h3 className="text-lg font-semibold mb-2 text-red-600">Preview Conflict Detected</h3>
            <div className="space-y-4">
              <p className="text-gray-600">
                A merge conflict was detected while trying to preview changes. You have two options:
              </p>
              
              <div className="bg-gray-50 p-4 rounded-md">
                <h4 className="font-medium mb-2">Option 1: Manual Resolution</h4>
                <p className="text-sm text-gray-600 mb-2">
                  You can manually resolve the conflict using these commands:
                </p>
                <pre className="bg-gray-900 text-gray-100 p-3 rounded text-xs overflow-x-auto">
{`cd ${task?.repoPath || 'your-repo'}
git cherry-pick ${conflictBranchName || 'branch-name'}
# Resolve conflicts in your editor
git add .
git cherry-pick --continue`}
                </pre>
              </div>
              
              <div className="bg-blue-50 p-4 rounded-md">
                <h4 className="font-medium mb-2">Option 2: Resubmit Task</h4>
                <p className="text-sm text-gray-600">
                  Create a new task with the same prompt, starting from the latest main branch changes.
                </p>
              </div>
            </div>
            
            <div className="flex justify-end space-x-2 mt-6">
              <Button
                onClick={() => {
                  setShowPreviewConflict(false)
                  setConflictBranchName(null)
                }}
                variant="outline"
                size="sm"
              >
                Close
              </Button>
              <Button
                onClick={() => {
                  setShowPreviewConflict(false)
                  handleResubmitTask()
                }}
                variant="default"
                size="sm"
              >
                Resubmit Task
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Merge Conflict Dialog */}
      {showMergeConflict && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
            <h3 className="text-lg font-semibold mb-2 text-red-600">Merge Conflict Detected</h3>
            <div className="space-y-4">
              <p className="text-gray-600">
                A merge conflict was detected while trying to merge to main. You have two options:
              </p>
              
              <div className="bg-gray-50 p-4 rounded-md">
                <h4 className="font-medium mb-2">Option 1: Manual Resolution</h4>
                <p className="text-sm text-gray-600 mb-2">
                  You can manually resolve the conflict using these commands:
                </p>
                <pre className="bg-gray-900 text-gray-100 p-3 rounded text-xs overflow-x-auto">
{`cd ${task?.repoPath || 'your-repo'}
git checkout main
git merge ${mergeConflictBranchName || 'branch-name'}
# Resolve conflicts in your editor
git add .
git commit`}
                </pre>
              </div>
              
              <div className="bg-blue-50 p-4 rounded-md">
                <h4 className="font-medium mb-2">Option 2: Resubmit Task</h4>
                <p className="text-sm text-gray-600">
                  Create a new task with the same prompt, starting from the latest main branch changes.
                </p>
              </div>
            </div>
            
            <div className="flex justify-end space-x-2 mt-6">
              <Button
                onClick={() => {
                  setShowMergeConflict(false)
                  setMergeConflictBranchName(null)
                }}
                variant="outline"
                size="sm"
              >
                Close
              </Button>
              <Button
                onClick={() => {
                  setShowMergeConflict(false)
                  handleResubmitTask()
                }}
                variant="default"
                size="sm"
              >
                Resubmit Task
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}