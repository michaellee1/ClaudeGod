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
import { Select } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown, Trash2 } from 'lucide-react'

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [prompt, setPrompt] = useState('')
  const [repoPath, setRepoPath] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDeletingAll, setIsDeletingAll] = useState(false)
  const [previewingTaskId, setPreviewingTaskId] = useState<string | null>(null)
  const [thinkMode, setThinkMode] = useState('level1')

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

  const handleDeleteAllTasks = async () => {
    if (!confirm('Are you sure you want to delete ALL tasks? This will remove all worktrees and changes permanently.')) {
      return
    }
    
    setIsDeletingAll(true)
    setError(null)
    
    try {
      const response = await fetch('/api/tasks', {
        method: 'DELETE',
      })
      if (response.ok) {
        fetchTasks()
      } else {
        const errorData = await response.json()
        setError(`Failed to delete all tasks: ${errorData.error || 'Unknown error'}`)
      }
    } catch (error: any) {
      console.error('Error deleting all tasks:', error)
      setError(`Failed to delete all tasks: ${error.message || 'Network error'}`)
    } finally {
      setIsDeletingAll(false)
    }
  }

  const handlePreview = async (taskId: string, isCurrentlyPreviewing: boolean) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}/preview`, {
        method: isCurrentlyPreviewing ? 'DELETE' : 'POST',
      })
      
      if (response.ok) {
        setPreviewingTaskId(isCurrentlyPreviewing ? null : taskId)
        setError(null)
      } else {
        const errorData = await response.json()
        setError(`Failed to ${isCurrentlyPreviewing ? 'stop' : 'start'} preview: ${errorData.error || 'Unknown error'}`)
      }
    } catch (error: any) {
      console.error('Error toggling preview:', error)
      setError(`Failed to ${isCurrentlyPreviewing ? 'stop' : 'start'} preview: ${error.message || 'Network error'}`)
    }
  }

  const handleMerge = async (taskId: string) => {
    if (!confirm('Are you sure you want to merge this task? This will merge the changes into the main branch.')) {
      return
    }
    
    try {
      const response = await fetch(`/api/tasks/${taskId}/merge`, {
        method: 'POST',
      })
      
      if (response.ok) {
        alert('Task merged successfully!')
        fetchTasks()
      } else {
        const errorData = await response.json()
        setError(`Failed to merge task: ${errorData.error || 'Unknown error'}`)
      }
    } catch (error: any) {
      console.error('Error merging task:', error)
      setError(`Failed to merge task: ${error.message || 'Network error'}`)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!prompt.trim() || !repoPath.trim()) return

    let finalPrompt = prompt
    if (thinkMode !== 'none') {
      const thinkModeText = thinkMode === 'level1' ? 'Think hard' : 
                           thinkMode === 'level2' ? 'Think harder' : 
                           'Ultrathink'
      finalPrompt = `${prompt}. ${thinkModeText}`
    }

    setIsSubmitting(true)
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: finalPrompt, repoPath }),
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
            
            <div className="space-y-2">
              <Label htmlFor="thinkMode">Think Mode</Label>
              <Select
                id="thinkMode"
                value={thinkMode}
                onChange={(e) => setThinkMode(e.target.value)}
              >
                <option value="none">None</option>
                <option value="level1">Think hard (level 1)</option>
                <option value="level2">Think harder (level 2)</option>
                <option value="level3">Ultrathink (level 3)</option>
              </Select>
            </div>
            
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Submitting...' : 'Submit Task'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Active Tasks</CardTitle>
              <CardDescription>View and manage your ongoing coding tasks</CardDescription>
            </div>
            {tasks.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    Actions
                    <ChevronDown className="ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={handleDeleteAllTasks}
                    disabled={isDeletingAll}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {isDeletingAll ? 'Deleting All Tasks...' : 'Delete All Tasks'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
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
                          onClick={() => handlePreview(task.id, previewingTaskId === task.id)}
                          variant="ghost"
                          size="icon"
                          className={`h-8 w-8 ${previewingTaskId === task.id ? 'text-orange-500 hover:text-orange-600' : 'hover:text-primary'}`}
                          title={previewingTaskId === task.id ? 'Stop Preview' : 'Preview Changes'}
                        >
                          {previewingTaskId === task.id ? (
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
                              <rect x="6" y="4" width="4" height="16" />
                              <rect x="14" y="4" width="4" height="16" />
                            </svg>
                          ) : (
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
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          )}
                        </Button>
                        <Button
                          onClick={() => handleMerge(task.id)}
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-green-600 hover:text-green-700"
                          title="Merge Task"
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
                            <circle cx="18" cy="18" r="3" />
                            <circle cx="6" cy="6" r="3" />
                            <path d="M6 21V9a9 9 0 0 0 9 9" />
                          </svg>
                        </Button>
                        <Button
                          onClick={() => handleDeleteTask(task.id)}
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          title="Delete Task"
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