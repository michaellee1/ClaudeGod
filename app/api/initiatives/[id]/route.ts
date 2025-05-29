import { NextRequest, NextResponse } from 'next/server'
import initiativeStore from '@/lib/utils/initiative-store'
import { join } from 'path'
import { readFile } from 'fs/promises'
import { withErrorHandler } from '@/lib/utils/error-handler'
import { InitiativeNotFoundError, ValidationError } from '@/lib/utils/errors'
import { InitiativePhase, InitiativeStatus } from '@/lib/types/initiative'

export const GET = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
    const { id } = await params

    if (!id || typeof id !== 'string') {
      throw new ValidationError('Invalid initiative ID', 'id', id)
    }

    const initiative = initiativeStore.get(id)
    if (!initiative) {
      throw new InitiativeNotFoundError(id)
    }

    // Prepare phase files data
    const phaseFiles: Record<string, any> = {}

    // Helper function to safely load phase files
    const loadPhaseFile = async (filename: string): Promise<any | null> => {
      try {
        const content = await initiativeStore.loadPhaseFile(id, filename)
        return JSON.parse(content)
      } catch (error) {
        // File doesn't exist or isn't valid JSON
        return null
      }
    }

    // Map InitiativePhase enum back to string for comparison
    const phaseToString: Record<string, string> = {
      [InitiativePhase.EXPLORATION]: 'exploration',
      [InitiativePhase.QUESTIONS]: 'questions',
      [InitiativePhase.RESEARCH_PREP]: 'research_prep',
      [InitiativePhase.RESEARCH_REVIEW]: 'research_review',
      [InitiativePhase.TASK_GENERATION]: 'task_generation',
      [InitiativePhase.READY]: 'ready'
    }
    
    const phaseString = phaseToString[initiative.currentPhase] || 'exploration'
    
    // Load phase-specific files based on current phase
    switch (phaseString) {
      case 'questions':
      case 'research_prep':
      case 'research_review':
      case 'task_generation':
      case 'ready':
        // These phases should have questions available
        const questionsData = await loadPhaseFile('questions.json')
        if (questionsData) {
          // Handle both formats: wrapped or unwrapped questions
          phaseFiles.questions = questionsData.questions || questionsData
        }

        if (phaseString !== 'questions') {
          // Load answers if past questions phase
          const answers = await loadPhaseFile('answers.json')
          if (answers) phaseFiles.answers = answers
        }

        if (phaseString === 'research_review' || phaseString === 'task_generation' || phaseString === 'ready') {
          // Load research prep output if available
          const researchPrep = await loadPhaseFile('research_prep.md')
          if (researchPrep) phaseFiles.researchPrep = researchPrep
        }

        if (phaseString === 'task_generation' || phaseString === 'ready') {
          // Load research if available
          try {
            const research = await initiativeStore.loadPhaseFile(id, 'research.md')
            if (research) phaseFiles.research = research
          } catch (error) {
            // Research is a markdown file, not JSON
          }
        }

        if (phaseString === 'ready') {
          // Load tasks if ready
          const tasks = await loadPhaseFile('tasks.json')
          if (tasks) phaseFiles.tasks = tasks
        }
        break
    }

    // Prepare full response
    const response = {
      id: initiative.id,
      objective: initiative.objective,
      phase: phaseString,
      currentPhase: initiative.currentPhase,
      status: initiative.status,
      createdAt: initiative.createdAt,
      updatedAt: initiative.updatedAt,
      yoloMode: initiative.yoloMode ?? true,
      currentStepIndex: initiative.currentStepIndex ?? 0,
      processId: initiative.processId,
      isActive: initiative.isActive ?? false,
      questions: Array.isArray(phaseFiles.questions) ? phaseFiles.questions : 
                (phaseFiles.questions?.questions || []),
      userAnswers: phaseFiles.answers || {},
      researchNeeds: phaseFiles.research || '',
      researchResults: phaseFiles.research || '',
      taskSteps: phaseFiles.tasks?.steps || [],
      phaseFiles,
      progress: {
        phase: phaseString,
        isComplete: phaseString === 'ready',
        hasQuestions: !!phaseFiles.questions,
        hasAnswers: !!phaseFiles.answers,
        hasResearch: !!phaseFiles.research,
        hasTasks: !!phaseFiles.tasks
      }
    }

    return NextResponse.json(response)
})

export const PATCH = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
    const { id } = await params

    if (!id || typeof id !== 'string') {
      throw new ValidationError('Invalid initiative ID', 'id', id)
    }

    const initiative = initiativeStore.get(id)
    if (!initiative) {
      throw new InitiativeNotFoundError(id)
    }

    let body;
    try {
      body = await request.json()
    } catch (error) {
      throw new ValidationError('Invalid JSON in request body')
    }

    // Update initiative with provided fields
    const updates: any = {}
    
    if (body.yoloMode !== undefined) {
      updates.yoloMode = body.yoloMode
    }

    const updatedInitiative = await initiativeStore.update(id, updates)

    // Map InitiativePhase enum back to string
    const phaseToString: Record<string, string> = {
      [InitiativePhase.EXPLORATION]: 'exploration',
      [InitiativePhase.QUESTIONS]: 'questions',
      [InitiativePhase.RESEARCH_PREP]: 'research_prep',
      [InitiativePhase.RESEARCH_REVIEW]: 'research_review',
      [InitiativePhase.TASK_GENERATION]: 'task_generation',
      [InitiativePhase.READY]: 'ready'
    }
    
    const phaseString = phaseToString[updatedInitiative.currentPhase] || 'exploration'
    
    return NextResponse.json({
      id: updatedInitiative.id,
      objective: updatedInitiative.objective,
      phase: phaseString,
      currentPhase: updatedInitiative.currentPhase,
      status: updatedInitiative.status,
      yoloMode: updatedInitiative.yoloMode,
      processId: updatedInitiative.processId,
      isActive: updatedInitiative.isActive ?? false,
      updatedAt: updatedInitiative.updatedAt
    })
})

export const DELETE = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
    const { id } = await params

    if (!id || typeof id !== 'string') {
      throw new ValidationError('Invalid initiative ID', 'id', id)
    }

    const initiative = initiativeStore.get(id)
    if (!initiative) {
      throw new InitiativeNotFoundError(id)
    }

    // Delete the initiative
    await initiativeStore.delete(id)

    return NextResponse.json({ success: true })
})

// Prevent static caching
export const dynamic = 'force-dynamic'