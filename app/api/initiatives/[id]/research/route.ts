import { NextRequest, NextResponse } from 'next/server'
import initiativeStore from '@/lib/utils/initiative-store'
import { InitiativeManager } from '@/lib/utils/initiative-manager'
import { validateResearch, VALIDATION_LIMITS } from '@/lib/utils/initiative-validation'
import { InitiativeResearch } from '@/lib/types/initiative'
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
    
    const { research } = body

    if (!research || typeof research !== 'string' || research.trim().length === 0) {
      throw new ValidationError('Research must be provided as a non-empty string', 'research', research)
    }

    // Validate research using validation utility
    const researchData: InitiativeResearch = {
      id: 'temp',
      topic: 'User Research',
      description: research.trim(),
      findings: research.trim(),
      createdAt: new Date()
    }
    const researchErrors = validateResearch(researchData)
    if (researchErrors.length > 0) {
      // Throw the first error for simplicity
      const firstError = researchErrors[0]
      throw new ValidationError(
        firstError.message,
        firstError.field,
        research
      )
    }

    const initiative = initiativeStore.get(id)
    if (!initiative) {
      throw new InitiativeNotFoundError(id)
    }

    if (initiative.phase !== 'research_review') {
      throw new InitiativeInvalidStateError(id, initiative.phase, 'research_review')
    }

    // Process research and trigger planning phase
    const manager = InitiativeManager.getInstance()
    await withRetry(
      () => manager.processResearch(id, research.trim()),
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
      status: 'research_submitted',
      message: 'Research submitted successfully. Task generation phase started.'
    })
})

// Prevent static caching
export const dynamic = 'force-dynamic'