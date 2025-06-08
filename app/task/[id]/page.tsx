'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Task } from '@/lib/types/task'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Terminal, ExternalLink, GitCommit, GitMerge, AlertCircle, Trash2, Plus } from 'lucide-react'

export default function TaskDetail() {
  const params = useParams()
  const router = useRouter()
  const [task, setTask] = useState<Task | null>(null)
  const [isMerging, setIsMerging] = useState(false)
  const [showMergeConfirm, setShowMergeConfirm] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [requestedChanges, setRequestedChanges] = useState('')
  const [isRequestingChanges, setIsRequestingChanges] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCommitting, setIsCommitting] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [isBringingToFront, setIsBringingToFront] = useState(false)

  const taskId = params.id as string
  
  useEffect(() => {
    if (taskId) {
      fetchTask()
      // Poll for updates every 5 seconds
      const interval = setInterval(fetchTask, 5000)
      return () => clearInterval(interval)
    }
  }, [taskId])

  const fetchTask = async () => {
    try {
      const res = await fetch('/api/tasks')
      const tasks = await res.json()
      const currentTask = tasks.find((t: Task) => t.id === taskId)
      if (currentTask) {
        setTask(currentTask)
        // Auto-generate commit message
        if (currentTask.status === 'finished' && !currentTask.commitHash && !commitMessage) {
          setCommitMessage(`Complete task: ${currentTask.prompt.substring(0, 60)}${currentTask.prompt.length > 60 ? '...' : ''}`)
        }
      }
    } catch (error) {
      console.error('Error fetching task:', error)
    }
  }

  const bringToFront = async () => {
    if (!task) return
    
    setIsBringingToFront(true)
    setError(null)
    
    try {
      const res = await fetch(`/api/tasks/${task.id}/focus`, {
        method: 'POST'
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to bring terminal to front')
      }
    } catch (error: any) {
      setError(error.message)
    } finally {
      setIsBringingToFront(false)
    }
  }

  const handleCommit = async () => {
    if (!task || !commitMessage.trim()) return
    
    setIsCommitting(true)
    setError(null)
    
    try {
      const res = await fetch(`/api/tasks/${task.id}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: commitMessage })
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to commit')
      }
      
      await fetchTask()
    } catch (error: any) {
      setError(error.message)
    } finally {
      setIsCommitting(false)
    }
  }

  const handleMerge = async () => {
    if (!task) return
    
    setIsMerging(true)
    setError(null)
    
    try {
      const res = await fetch(`/api/tasks/${task.id}/merge`, {
        method: 'POST'
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to merge')
      }
      
      setShowMergeConfirm(false)
      await fetchTask()
    } catch (error: any) {
      setError(error.message)
    } finally {
      setIsMerging(false)
    }
  }

  const handleRequestChanges = async () => {
    if (!task || !requestedChanges.trim()) return
    
    setIsRequestingChanges(true)
    setError(null)
    
    try {
      const formData = new FormData()
      formData.append('requestedChanges', requestedChanges)
      
      const res = await fetch(`/api/tasks/${task.id}/request-changes`, {
        method: 'POST',
        body: formData
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to request changes')
      }
      
      const data = await res.json()
      router.push(`/task/${data.newTask.id}`)
    } catch (error: any) {
      setError(error.message)
    } finally {
      setIsRequestingChanges(false)
    }
  }

  const handleRemove = async () => {
    if (!task) return
    
    setIsRemoving(true)
    
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'DELETE'
      })
      
      if (res.ok) {
        router.push('/')
      }
    } catch (error) {
      console.error('Error removing task:', error)
    } finally {
      setIsRemoving(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'starting': return 'bg-gray-500'
      case 'in_progress': return 'bg-blue-500'
      case 'finished': return 'bg-green-500'
      case 'failed': return 'bg-red-500'
      case 'merged': return 'bg-purple-500'
      default: return 'bg-gray-500'
    }
  }

  const getPhaseText = (phase: string, mode?: string) => {
    if (mode === 'planning' && phase === 'planning') return 'Planning'
    if (phase === 'edit') return 'Editing'
    if (phase === 'done') return 'Complete'
    return phase
  }

  if (!task) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardContent className="p-8">
            <p className="text-center text-muted-foreground">Loading task...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <Button variant="outline" onClick={() => router.push('/')}>
          ← Back to Tasks
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={handleRemove}
          disabled={isRemoving}
        >
          <Trash2 className="w-4 h-4 mr-1" />
          {isRemoving ? 'Removing...' : 'Remove Task'}
        </Button>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-2xl">Task {task.id}</CardTitle>
              <CardDescription className="mt-2">{task.prompt}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={getStatusColor(task.status)}>
                {task.status}
              </Badge>
              {task.mode && (
                <Badge variant="outline">
                  Mode: {task.mode}
                </Badge>
              )}
              <Badge variant="outline">
                {getPhaseText(task.phase, task.mode)}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Terminal Control */}
            {task.status === 'in_progress' && (
              <div className="flex items-center justify-center p-8 bg-muted rounded-lg">
                <div className="text-center space-y-4">
                  <Terminal className="w-16 h-16 mx-auto text-muted-foreground" />
                  <p className="text-lg font-medium">Task is running in iTerm</p>
                  <Button 
                    onClick={bringToFront}
                    disabled={isBringingToFront}
                    size="lg"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    {isBringingToFront ? 'Bringing to Front...' : 'Bring Terminal to Front'}
                  </Button>
                </div>
              </div>
            )}

            {/* Error Display */}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Task Actions */}
            {task.status === 'finished' && !task.commitHash && (
              <Card>
                <CardHeader>
                  <CardTitle>Commit Changes</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="commit-message">Commit Message</Label>
                      <Textarea
                        id="commit-message"
                        value={commitMessage}
                        onChange={(e) => setCommitMessage(e.target.value)}
                        placeholder="Enter commit message..."
                        className="mt-1"
                      />
                    </div>
                    <Button 
                      onClick={handleCommit}
                      disabled={isCommitting || !commitMessage.trim()}
                      className="w-full"
                    >
                      <GitCommit className="w-4 h-4 mr-2" />
                      {isCommitting ? 'Committing...' : 'Commit Changes'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {task.commitHash && task.status === 'finished' && (
              <Card>
                <CardHeader>
                  <CardTitle>Merge to Main</CardTitle>
                  <CardDescription>
                    Commit: {task.commitHash.substring(0, 7)}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button 
                    onClick={() => setShowMergeConfirm(true)}
                    className="w-full"
                    variant="default"
                  >
                    <GitMerge className="w-4 h-4 mr-2" />
                    Merge to Main Branch
                  </Button>
                </CardContent>
              </Card>
            )}

            {task.status === 'finished' && (
              <Card>
                <CardHeader>
                  <CardTitle>Request Changes</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="requested-changes">What changes would you like?</Label>
                      <Textarea
                        id="requested-changes"
                        value={requestedChanges}
                        onChange={(e) => setRequestedChanges(e.target.value)}
                        placeholder="Describe the changes you want..."
                        className="mt-1"
                        rows={4}
                      />
                    </div>
                    <Button 
                      onClick={handleRequestChanges}
                      disabled={isRequestingChanges || !requestedChanges.trim()}
                      className="w-full"
                      variant="secondary"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      {isRequestingChanges ? 'Creating New Task...' : 'Request Changes'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {task.previousTaskId && (
              <Alert>
                <AlertDescription>
                  This task is a follow-up to{' '}
                  <Button
                    variant="link"
                    className="p-0 h-auto"
                    onClick={() => router.push(`/task/${task.previousTaskId}`)}
                  >
                    task {task.previousTaskId}
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Merge Confirmation Dialog */}
      <Dialog open={showMergeConfirm} onOpenChange={setShowMergeConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Merge</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-4">
            Are you sure you want to merge this task to the main branch?
          </p>
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              onClick={() => setShowMergeConfirm(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleMerge}
              disabled={isMerging}
            >
              {isMerging ? 'Merging...' : 'Confirm Merge'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}