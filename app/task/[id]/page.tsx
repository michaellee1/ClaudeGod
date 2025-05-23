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
  const [isCommitting, setIsCommitting] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [additionalPrompt, setAdditionalPrompt] = useState('')
  const [isSendingPrompt, setIsSendingPrompt] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const outputEndRef = useRef<HTMLDivElement>(null)

  const taskId = params.id as string

  useEffect(() => {
    if (taskId) {
      fetchTask()
      const interval = setInterval(() => {
        fetchTask()
        fetchOutputs()
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [taskId])

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [outputs])

  const fetchTask = async () => {
    try {
      const response = await fetch(`/api/tasks/${taskId}`)
      if (response.ok) {
        const data = await response.json()
        setTask(data)
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

  const handleCommit = async () => {
    if (!confirm('Are you sure you want to commit the changes? This will complete the task.')) {
      return
    }
    
    setIsCommitting(true)
    try {
      const response = await fetch(`/api/tasks/${taskId}/commit`, {
        method: 'POST',
      })
      if (response.ok) {
        router.push('/')
      } else {
        const errorData = await response.json()
        setError(`Failed to commit: ${errorData.error || 'Unknown error'}`)
      }
    } catch (error: any) {
      console.error('Error committing task:', error)
      setError(`Failed to commit task: ${error.message || 'Network error'}`)
    } finally {
      setIsCommitting(false)
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
    <div className="container mx-auto p-8">
      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Task Details</CardTitle>
              <CardDescription className="mt-2 space-y-1">
                <span className="block font-mono text-sm">ID: {task.id}</span>
                <span className="block">Prompt: {task.prompt}</span>
              </CardDescription>
            </div>
            <div className="flex items-center space-x-2">
              <Badge
                variant={
                  task.status === 'starting' ? 'outline' :
                  task.status === 'in_progress' ? 'default' :
                  task.status === 'finished' ? 'secondary' :
                  'destructive'
                }
              >
                {task.status}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {task.phase}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex space-x-4">
            <Button
              onClick={handleCommit}
              disabled={isCommitting || task.status === 'finished'}
              variant="default"
            >
              {isCommitting ? 'Committing...' : 'Commit Code'}
            </Button>
            <Button
              onClick={handleRemove}
              disabled={isRemoving}
              variant="destructive"
            >
              {isRemoving ? 'Removing...' : 'Remove Task'}
            </Button>
            <Button
              onClick={() => router.push('/')}
              variant="outline"
            >
              Back to Tasks
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-6">
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Send Additional Prompt</CardTitle>
            <CardDescription>Continue the conversation with Claude</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="additionalPrompt">Additional Instructions</Label>
                <Textarea
                  id="additionalPrompt"
                  value={additionalPrompt}
                  onChange={(e) => setAdditionalPrompt(e.target.value)}
                  className="min-h-[200px]"
                  placeholder="Add more instructions or feedback..."
                  disabled={task.status === 'finished'}
                />
              </div>
              <Button
                onClick={handleSendPrompt}
                disabled={isSendingPrompt || task.status === 'finished' || !additionalPrompt.trim()}
                className="w-full"
              >
                {isSendingPrompt ? 'Sending...' : 'Send Prompt'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-2">
          <CardHeader>
            <CardTitle>Process Output</CardTitle>
            <CardDescription>Live stream of editor and reviewer outputs</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-slate-950 text-slate-50 p-4 rounded-lg h-[600px] overflow-y-auto font-mono text-sm">
              {outputs.map((output) => (
                <div key={output.id} className="mb-4">
                  <div className={`font-bold ${
                    output.type === 'editor' ? 'text-emerald-400' : 'text-sky-400'
                  }`}>
                    [{output.type.toUpperCase()}] {new Date(output.timestamp).toLocaleTimeString()}
                  </div>
                  <pre className="whitespace-pre-wrap text-slate-300">{output.content}</pre>
                </div>
              ))}
              <div ref={outputEndRef} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}