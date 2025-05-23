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
        router.push('/')
      } else {
        const errorData = await response.json()
        const errorMessage = errorData.error || 'Unknown error'
        if (errorMessage.startsWith('MERGE_CONFLICT:')) {
          const branchName = errorMessage.split(':')[1]
          setError(`Merge conflict detected! You can manually merge with:\n\ngit checkout main\ngit merge ${branchName}\n\nThen resolve conflicts and commit, or create a new task with the latest changes.`)
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
        setError(`Failed to start preview: ${errorData.error || 'Unknown error'}`)
        setIsPreviewing(false)
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
                disabled={isMerging || !task.commitHash}
                variant="default"
                className="w-full"
                size="sm"
              >
                {isMerging ? 'Merging...' : 'Merge to Main'}
              </Button>
              
              {task.commitHash && (
                <Button
                  onClick={isPreviewing ? handleStopPreview : handleStartPreview}
                  disabled={task.status !== 'finished' || isMerging}
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
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Textarea
                  id="additionalPrompt"
                  value={additionalPrompt}
                  onChange={(e) => setAdditionalPrompt(e.target.value)}
                  className="min-h-[200px]"
                  placeholder="Add more instructions or feedback..."
                  disabled={task.status === 'finished'}
                />
                <Button
                  onClick={handleSendPrompt}
                  disabled={isSendingPrompt || task.status === 'finished' || !additionalPrompt.trim()}
                  className="w-full"
                  size="sm"
                >
                  {isSendingPrompt ? 'Sending...' : 'Send Prompt'}
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
            
            return (
              <div key={output.id} className="mb-4">
                <div className={`font-semibold ${
                  output.type === 'editor' ? 'text-green-700' : 'text-blue-700'
                }`}>
                  [{output.type.toUpperCase()}] {new Date(output.timestamp).toLocaleTimeString()}
                </div>
                {isToolUse ? (
                  <div className="text-gray-600 italic mt-1">{output.content}</div>
                ) : isFileContent ? (
                  <pre className="whitespace-pre-wrap text-gray-600 leading-relaxed text-xs mt-1 font-mono">{output.content}</pre>
                ) : (
                  <pre className="whitespace-pre-wrap text-gray-800 leading-relaxed mt-1">{output.content}</pre>
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
              Are you sure you want to merge this task to the main branch? This will apply the changes permanently and remove the task.
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
    </div>
  )
}