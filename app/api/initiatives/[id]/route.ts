import { NextRequest, NextResponse } from 'next/server'
import initiativeStore from '@/lib/utils/initiative-store'
import { join } from 'path'
import { readFile } from 'fs/promises'
import { withErrorHandler } from '@/lib/utils/error-handler'
import { InitiativeNotFoundError, ValidationError } from '@/lib/utils/errors'

export const GET = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: { id: string } }
) => {
    const { id } = params

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

    // Load phase-specific files based on current phase
    switch (initiative.phase) {
      case 'questions':
      case 'research_prep':
      case 'research_review':
      case 'task_generation':
      case 'ready':
        // These phases should have questions available
        const questions = await loadPhaseFile('questions.json')
        if (questions) phaseFiles.questions = questions

        if (initiative.phase !== 'questions') {
          // Load answers if past questions phase
          const answers = await loadPhaseFile('answers.json')
          if (answers) phaseFiles.answers = answers
        }

        if (initiative.phase === 'research_review' || initiative.phase === 'task_generation' || initiative.phase === 'ready') {
          // Load research prep output if available
          const researchPrep = await loadPhaseFile('research_prep.md')
          if (researchPrep) phaseFiles.researchPrep = researchPrep
        }

        if (initiative.phase === 'task_generation' || initiative.phase === 'ready') {
          // Load research if available
          try {
            const research = await initiativeStore.loadPhaseFile(id, 'research.md')
            if (research) phaseFiles.research = research
          } catch (error) {
            // Research is a markdown file, not JSON
          }
        }

        if (initiative.phase === 'ready') {
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
      phase: initiative.phase,
      status: initiative.isActive ? 'active' : 'completed',
      createdAt: initiative.createdAt,
      updatedAt: initiative.updatedAt,
      tasksCreated: (initiative.phaseData?.tasksCreated as number) || 0,
      phaseFiles,
      progress: {
        phase: initiative.phase,
        isComplete: initiative.phase === 'ready',
        hasQuestions: !!phaseFiles.questions,
        hasAnswers: !!phaseFiles.answers,
        hasResearch: !!phaseFiles.research,
        hasTasks: !!phaseFiles.tasks
      }
    }

    return NextResponse.json(response)
})

// Prevent static caching
export const dynamic = 'force-dynamic'