'use client'

import { useState, useEffect } from 'react'
import { Task } from '@/lib/types/task'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [prompt, setPrompt] = useState('')
  const [repoPath, setRepoPath] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchTasks()
    fetchRepoPath()
    const interval = setInterval(fetchTasks, 2000)
    return () => clearInterval(interval)
  }, [])

  const fetchRepoPath = async () => {
    try {
      const response = await fetch('/api/config')
      if (response.ok) {
        const data = await response.json()
        if (data.repoPath) {
          setRepoPath(data.repoPath)
        }
      }
    } catch (error) {
      console.error('Error fetching repo path:', error)
    }
  }

  const fetchTasks = async () => {
    try {
      const response = await fetch('/api/tasks')
      if (response.ok) {
        const data = await response.json()
        setTasks(data)
      }
    } catch (error) {
      console.error('Error fetching tasks:', error)
    }
  }

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('Are you sure you want to remove this task? This will delete the worktree and all changes.')) {
      return
    }
    
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        fetchTasks()
      } else {
        const errorData = await response.json()
        setError(`Failed to remove task: ${errorData.error || 'Unknown error'}`)
      }
    } catch (error: any) {
      console.error('Error removing task:', error)
      setError(`Failed to remove task: ${error.message || 'Network error'}`)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!prompt.trim() || !repoPath.trim()) return

    setIsSubmitting(true)
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, repoPath }),
      })

      if (response.ok) {
        setPrompt('')
        setError(null)
        fetchTasks()
      } else {
        const errorData = await response.json()
        setError(`Failed to create task: ${errorData.error || 'Unknown error'}`)
      }
    } catch (error: any) {
      console.error('Error submitting task:', error)
      setError(`Failed to submit task: ${error.message || 'Network error'}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="container mx-auto p-8">
      
      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Submit New Task</CardTitle>
          <CardDescription>Create a new coding task for Claude to work on</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="repoPath">Repository Path</Label>
              <Input
                id="repoPath"
                type="text"
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                placeholder="/path/to/your/repo"
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="prompt">Task Description</Label>
              <Textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="min-h-[120px]"
                placeholder="Describe your task..."
                required
              />
            </div>
            
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Submitting...' : 'Submit Task'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active Tasks</CardTitle>
          <CardDescription>View and manage your ongoing coding tasks</CardDescription>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <p className="text-muted-foreground">No active tasks</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Prompt</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Phase</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="font-mono text-sm">
                      {task.id.substring(0, 8)}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">
                      {task.prompt}
                    </TableCell>
                    <TableCell>
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
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {task.phase}
                      </span>
                    </TableCell>
                    <TableCell>
                      {new Date(task.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button variant="link" asChild>
                          <Link href={`/task/${task.id}`}>
                            View Details
                          </Link>
                        </Button>
                        <Button
                          onClick={() => handleDeleteTask(task.id)}
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}