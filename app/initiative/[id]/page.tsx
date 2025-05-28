'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Initiative, InitiativePhase, InitiativeStatus, InitiativeOutput, InitiativeQuestion, InitiativeTaskStep } from '@/lib/types/initiative'
import { useInitiativeWebSocket } from '@/lib/hooks/useInitiativeWebSocket'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default function InitiativeDetail() {
  const params = useParams()
  const router = useRouter()
  const [initiative, setInitiative] = useState<Initiative | null>(null)
  const [outputs, setOutputs] = useState<InitiativeOutput[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [researchResults, setResearchResults] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set(['current']))
  const [showRawOutput, setShowRawOutput] = useState(false)
  const outputEndRef = useRef<HTMLDivElement>(null)

  const initiativeId = params.id as string

  // WebSocket handlers
  const handleInitiativeUpdate = useCallback((updatedInitiative: Initiative) => {
    setInitiative(updatedInitiative)
    // Initialize answers from existing data
    if (updatedInitiative.userAnswers) {
      setAnswers(updatedInitiative.userAnswers)
    }
    if (updatedInitiative.researchResults) {
      setResearchResults(updatedInitiative.researchResults)
    }
  }, [])

  const handleInitiativeOutput = useCallback((output: InitiativeOutput) => {
    setOutputs(prev => [...prev, output])
  }, [])

  const fetchInitiative = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/initiatives/${initiativeId}`)
      if (response.ok) {
        const data = await response.json()
        setInitiative(data)
        // Initialize state from fetched data
        if (data.userAnswers) {
          setAnswers(data.userAnswers)
        }
        if (data.researchResults) {
          setResearchResults(data.researchResults)
        }
      } else {
        setError('Failed to load initiative')
      }
    } catch (error) {
      console.error('Error fetching initiative:', error)
      setError('Failed to load initiative')
    } finally {
      setIsLoading(false)
    }
  }, [initiativeId])

  const handlePhaseComplete = useCallback((phase: InitiativePhase) => {
    // Refresh initiative data
    fetchInitiative()
  }, [fetchInitiative])

  const handleError = useCallback((errorMessage: string) => {
    setError(errorMessage)
  }, [])

  const handleInitiativeRemoved = useCallback((removedId: string) => {
    if (removedId === initiativeId) {
      router.push('/initiatives')
    }
  }, [initiativeId, router])

  // Use WebSocket for real-time updates
  const { subscribeToInitiative, unsubscribeFromInitiative } = useInitiativeWebSocket('/ws', {
    onInitiativeUpdate: handleInitiativeUpdate,
    onInitiativeOutput: handleInitiativeOutput,
    onPhaseComplete: handlePhaseComplete,
    onError: handleError,
    onInitiativeRemoved: handleInitiativeRemoved
  })

  useEffect(() => {
    if (initiativeId) {
      fetchInitiative()
      subscribeToInitiative(initiativeId)
    }
    
    return () => {
      if (initiativeId) {
        unsubscribeFromInitiative(initiativeId)
      }
    }
  }, [initiativeId, subscribeToInitiative, unsubscribeFromInitiative, fetchInitiative])

  // Auto-scroll to bottom when new outputs arrive
  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [outputs])

  const handleSubmitAnswers = async () => {
    if (!initiative || !initiative.questions) return
    
    // Validate all questions are answered
    const unansweredQuestions = initiative.questions.filter(q => !answers[q.id]?.trim())
    if (unansweredQuestions.length > 0) {
      setError('Please answer all questions before submitting')
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      const response = await fetch(`/api/initiatives/${initiativeId}/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers })
      })
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to submit answers')
      }
      
      // Clear form and refresh data
      await fetchInitiative()
    } catch (error: any) {
      setError(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmitResearch = async () => {
    if (!researchResults.trim()) {
      setError('Please provide research results before submitting')
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      const response = await fetch(`/api/initiatives/${initiativeId}/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ research: researchResults })
      })
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to submit research')
      }
      
      // Refresh data
      await fetchInitiative()
    } catch (error: any) {
      setError(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmitTaskStep = async (stepId: string) => {
    setIsSubmitting(true)
    setError(null)
    try {
      const response = await fetch(`/api/initiatives/${initiativeId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepId })
      })
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to submit tasks')
      }
      
      // Refresh data
      await fetchInitiative()
    } catch (error: any) {
      setError(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCopyResearchNeeds = () => {
    if (initiative?.researchNeeds) {
      navigator.clipboard.writeText(initiative.researchNeeds)
    }
  }

  const togglePhaseExpansion = (phase: string) => {
    setExpandedPhases(prev => {
      const next = new Set(prev)
      if (next.has(phase)) {
        next.delete(phase)
      } else {
        next.add(phase)
      }
      return next
    })
  }

  const getPhaseStatus = (phase: InitiativePhase): 'completed' | 'current' | 'pending' => {
    if (!initiative) return 'pending'
    
    const phaseOrder = [
      InitiativePhase.EXPLORATION,
      InitiativePhase.QUESTIONS,
      InitiativePhase.RESEARCH_PREP,
      InitiativePhase.RESEARCH_REVIEW,
      InitiativePhase.TASK_GENERATION,
      InitiativePhase.READY
    ]
    
    const currentIndex = phaseOrder.indexOf(initiative.currentPhase)
    const phaseIndex = phaseOrder.indexOf(phase)
    
    if (phaseIndex < currentIndex) return 'completed'
    if (phaseIndex === currentIndex) return 'current'
    return 'pending'
  }

  const renderPhaseContent = (phase: InitiativePhase) => {
    switch (phase) {
      case InitiativePhase.EXPLORATION:
        return (
          <div className="space-y-4">
            {initiative?.status === InitiativeStatus.EXPLORING ? (
              <div className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-900"></div>
                <span className="text-sm text-muted-foreground">Exploring codebase and generating questions...</span>
              </div>
            ) : initiative?.questions && initiative.questions.length > 0 ? (
              <div>
                <p className="text-sm text-muted-foreground mb-2">Exploration complete. {initiative.questions.length} questions generated.</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Exploration phase pending.</p>
            )}
          </div>
        )

      case InitiativePhase.QUESTIONS:
        return (
          <div className="space-y-4">
            {initiative?.questions && initiative.questions.map((question: InitiativeQuestion) => (
              <div key={question.id} className="space-y-2">
                <div className="flex items-start justify-between">
                  <Label htmlFor={`answer-${question.id}`} className="text-sm font-medium">
                    {question.question}
                  </Label>
                  {question.priority && (
                    <Badge variant={question.priority === 'high' ? 'destructive' : question.priority === 'medium' ? 'default' : 'secondary'} className="text-xs">
                      {question.priority}
                    </Badge>
                  )}
                </div>
                {question.category && (
                  <p className="text-xs text-muted-foreground">Category: {question.category}</p>
                )}
                <Textarea
                  id={`answer-${question.id}`}
                  value={answers[question.id] || ''}
                  onChange={(e) => setAnswers(prev => ({ ...prev, [question.id]: e.target.value }))}
                  placeholder="Enter your answer..."
                  className="min-h-[100px]"
                  disabled={initiative?.status !== InitiativeStatus.AWAITING_ANSWERS}
                />
              </div>
            ))}
            {initiative?.status === InitiativeStatus.AWAITING_ANSWERS && (
              <Button
                onClick={handleSubmitAnswers}
                disabled={isSubmitting}
                className="w-full"
              >
                {isSubmitting ? 'Submitting...' : 'Submit Answers'}
              </Button>
            )}
          </div>
        )

      case InitiativePhase.RESEARCH_PREP:
        return (
          <div className="space-y-4">
            {initiative?.status === InitiativeStatus.RESEARCHING ? (
              <div className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-900"></div>
                <span className="text-sm text-muted-foreground">Preparing research needs document...</span>
              </div>
            ) : initiative?.researchNeeds ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">Research Needs Document</p>
                  <Button
                    onClick={handleCopyResearchNeeds}
                    variant="outline"
                    size="sm"
                  >
                    Copy to Clipboard
                  </Button>
                </div>
                <pre className="bg-gray-50 p-4 rounded-lg text-sm overflow-x-auto whitespace-pre-wrap">
                  {initiative.researchNeeds}
                </pre>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Research preparation pending.</p>
            )}
          </div>
        )

      case InitiativePhase.RESEARCH_REVIEW:
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="research-results" className="text-sm font-medium">
                Paste Research Results
              </Label>
              <Textarea
                id="research-results"
                value={researchResults}
                onChange={(e) => setResearchResults(e.target.value)}
                placeholder="Paste the research results from Deep Research here..."
                className="min-h-[300px] font-mono text-xs"
                disabled={initiative?.status !== InitiativeStatus.AWAITING_RESEARCH}
              />
            </div>
            {initiative?.status === InitiativeStatus.AWAITING_RESEARCH && (
              <Button
                onClick={handleSubmitResearch}
                disabled={isSubmitting || !researchResults.trim()}
                className="w-full"
              >
                {isSubmitting ? 'Submitting...' : 'Submit Research'}
              </Button>
            )}
          </div>
        )

      case InitiativePhase.TASK_GENERATION:
        return (
          <div className="space-y-4">
            {initiative?.status === InitiativeStatus.PLANNING ? (
              <div className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-900"></div>
                <span className="text-sm text-muted-foreground">Generating task breakdown...</span>
              </div>
            ) : initiative?.taskSteps && initiative.taskSteps.length > 0 ? (
              <div className="space-y-6">
                {initiative.taskSteps.map((step: InitiativeTaskStep) => (
                  <Card key={step.id}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">{step.name}</CardTitle>
                        <Badge variant={
                          step.status === 'completed' ? 'success' :
                          step.status === 'in_progress' ? 'default' :
                          'secondary'
                        }>
                          {step.status}
                        </Badge>
                      </div>
                      <CardDescription>{step.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Task</TableHead>
                            <TableHead>Priority</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {step.tasks.map((task) => (
                            <TableRow key={task.id}>
                              <TableCell>
                                <div>
                                  <p className="font-medium">{task.title}</p>
                                  <p className="text-sm text-muted-foreground">{task.description}</p>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant={
                                  task.priority === 'high' ? 'destructive' :
                                  task.priority === 'medium' ? 'default' :
                                  'secondary'
                                }>
                                  {task.priority}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant={
                                  task.status === 'submitted' ? 'success' :
                                  task.status === 'ready' ? 'default' :
                                  'outline'
                                }>
                                  {task.status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {step.status === 'pending' && initiative.status === InitiativeStatus.READY_FOR_TASKS && (
                        <Button
                          onClick={() => handleSubmitTaskStep(step.id)}
                          disabled={isSubmitting}
                          className="w-full mt-4"
                        >
                          {isSubmitting ? 'Submitting Tasks...' : `Submit ${step.tasks.length} Tasks`}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Task generation pending.</p>
            )}
          </div>
        )

      case InitiativePhase.READY:
        return (
          <div className="space-y-4">
            <Alert>
              <AlertDescription>
                {initiative?.totalTasks && initiative?.submittedTasks !== undefined ? (
                  <div>
                    <p className="font-medium mb-2">Initiative Progress</p>
                    <p className="text-sm">{initiative.submittedTasks} of {initiative.totalTasks} tasks submitted</p>
                    {initiative.submittedTasks === initiative.totalTasks && (
                      <p className="text-sm text-green-600 mt-2">All tasks have been submitted!</p>
                    )}
                  </div>
                ) : (
                  <p>Ready to submit tasks to the task system.</p>
                )}
              </AlertDescription>
            </Alert>
          </div>
        )

      default:
        return null
    }
  }

  if (isLoading) {
    return (
      <div className="container mx-auto p-8">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">Loading initiative...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!initiative) {
    return (
      <div className="container mx-auto p-8">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">Initiative not found</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-4 max-w-6xl">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
          <Button
            onClick={() => router.push('/initiatives')}
            variant="ghost"
            size="sm"
            className="h-6 px-2"
          >
            Initiatives
          </Button>
          <span>/</span>
          <span>{initiative.id}</span>
        </div>
        <h1 className="text-2xl font-bold mb-2">{initiative.objective}</h1>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{initiative.status}</Badge>
          <Badge>{initiative.currentPhase}</Badge>
          {initiative.lastError && (
            <Badge variant="destructive">Error</Badge>
          )}
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {initiative.lastError && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>
            <p className="font-medium mb-1">Process Error:</p>
            <pre className="text-xs whitespace-pre-wrap">{initiative.lastError}</pre>
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="workflow" className="space-y-4">
        <TabsList>
          <TabsTrigger value="workflow">Workflow</TabsTrigger>
          <TabsTrigger value="output">Process Output</TabsTrigger>
          <TabsTrigger value="files">Raw Files</TabsTrigger>
        </TabsList>

        <TabsContent value="workflow" className="space-y-4">
          {([
            InitiativePhase.EXPLORATION,
            InitiativePhase.QUESTIONS,
            InitiativePhase.RESEARCH_PREP,
            InitiativePhase.RESEARCH_REVIEW,
            InitiativePhase.TASK_GENERATION,
            InitiativePhase.READY
          ] as InitiativePhase[]).map((phase) => {
            const status = getPhaseStatus(phase)
            const isExpanded = expandedPhases.has(status === 'current' ? 'current' : phase)
            
            return (
              <Card key={phase} className={status === 'current' ? 'border-primary' : ''}>
                <CardHeader 
                  className="cursor-pointer"
                  onClick={() => togglePhaseExpansion(status === 'current' ? 'current' : phase)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full ${
                        status === 'completed' ? 'bg-green-500' :
                        status === 'current' ? 'bg-blue-500' :
                        'bg-gray-300'
                      }`} />
                      <CardTitle className="text-lg">
                        {phase.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                      </CardTitle>
                    </div>
                    <svg
                      className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </CardHeader>
                {isExpanded && (
                  <CardContent>
                    {renderPhaseContent(phase)}
                  </CardContent>
                )}
              </Card>
            )
          })}
        </TabsContent>

        <TabsContent value="output" className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <div className="bg-gray-900 text-gray-100 p-4 rounded-lg font-mono text-xs max-h-[600px] overflow-y-auto">
                {outputs.length === 0 ? (
                  <p className="text-gray-500">No output yet...</p>
                ) : (
                  outputs.map((output, index) => (
                    <div key={index} className="mb-2">
                      <span className={`font-bold ${
                        output.type === 'error' ? 'text-red-400' :
                        output.type === 'phase_complete' ? 'text-green-400' :
                        output.type === 'question' ? 'text-blue-400' :
                        output.type === 'task' ? 'text-purple-400' :
                        'text-gray-400'
                      }`}>
                        [{output.type.toUpperCase()}]
                      </span>
                      <span className="text-gray-500 ml-2">
                        {new Date(output.timestamp).toLocaleTimeString()}
                      </span>
                      <pre className="whitespace-pre-wrap mt-1">{output.content}</pre>
                    </div>
                  ))
                )}
                <div ref={outputEndRef} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="files" className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-4">
                Raw initiative files are stored at: ~/.claude-god-data/initiatives/{initiative.id}/
              </p>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(`/api/initiatives/${initiativeId}/outputs?file=questions.json`)}
                  disabled={!initiative.questions || initiative.questions.length === 0}
                >
                  View questions.json
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(`/api/initiatives/${initiativeId}/outputs?file=answers.json`)}
                  disabled={!initiative.userAnswers}
                >
                  View answers.json
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(`/api/initiatives/${initiativeId}/outputs?file=research-needs.md`)}
                  disabled={!initiative.researchNeeds}
                >
                  View research-needs.md
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(`/api/initiatives/${initiativeId}/outputs?file=research-results.md`)}
                  disabled={!initiative.researchResults}
                >
                  View research-results.md
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(`/api/initiatives/${initiativeId}/outputs?file=tasks.json`)}
                  disabled={!initiative.taskSteps || initiative.taskSteps.length === 0}
                >
                  View tasks.json
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}