import { NextRequest, NextResponse } from 'next/server'
import initiativeStore from '@/lib/utils/initiative-store'
import { InitiativeManager } from '@/lib/utils/initiative-manager'
import { validateAnswers, VALIDATION_LIMITS, InitiativeAnswer } from '@/lib/utils/initiative-validation'
import { withErrorHandler, withRetry } from '@/lib/utils/error-handler'
import { 
  ValidationError, 
  InitiativeNotFoundError, 
  InitiativeInvalidStateError,
  InitiativeLimitExceededError 
} from '@/lib/utils/errors'

export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: { id: string } }
) => {
    const { id } = params

    if (!id || typeof id !== 'string') {
      throw new ValidationError('Invalid initiative ID', 'id', id)
    }

    let body;
    try {
      body = await request.json()
    } catch (error) {
      throw new ValidationError('Invalid JSON in request body')
    }
    
    const { answers } = body

    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      throw new ValidationError('Answers must be provided as an object', 'answers', answers)
    }

    // Validate all answers are strings and convert to InitiativeAnswer format
    const answerArray: InitiativeAnswer[] = []
    for (const [key, value] of Object.entries(answers)) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        throw new ValidationError(
          'All answer keys and values must be strings',
          `answers.${key}`,
          value
        )
      }
      answerArray.push({ questionId: key, text: value })
    }

    // Validate answers using validation utility
    const answerErrors = validateAnswers(answerArray)
    if (answerErrors.length > 0) {
      // Throw the first error for simplicity
      const firstError = answerErrors[0]
      throw new ValidationError(
        firstError.message,
        firstError.field,
        answerArray
      )
    }

    const initiative = initiativeStore.get(id)
    if (!initiative) {
      throw new InitiativeNotFoundError(id)
    }

    if (initiative.phase !== 'questions') {
      throw new InitiativeInvalidStateError(id, initiative.phase, 'questions')
    }

    // Process answers and trigger refinement phase
    const manager = InitiativeManager.getInstance()
    await withRetry(
      () => manager.processAnswers(id, answers),
      { maxRetries: 3 }
    )

    // Get updated initiative
    const updatedInitiative = initiativeStore.get(id)
    if (!updatedInitiative) {
      throw new InitiativeNotFoundError(id)
    }

    return NextResponse.json({
      id: updatedInitiative.id,
      phase: updatedInitiative.phase,
      status: 'answers_submitted',
      message: 'Answers submitted successfully. Research preparation phase started.'
    })
})

// Prevent static caching
export const dynamic = 'force-dynamic'