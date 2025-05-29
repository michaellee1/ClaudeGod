import { NextRequest, NextResponse } from 'next/server'
import initiativeStore from '@/lib/utils/initiative-store'
import { 
  validateInitiative, 
  performPreflightChecks,
  generateValidationReport,
  ValidationReport 
} from '@/lib/utils/initiative-validation'
import { Initiative, InitiativePhase, InitiativeStatus } from '@/lib/types/initiative'
import { withErrorHandler } from '@/lib/utils/error-handler'
import { ValidationError, InitiativeNotFoundError } from '@/lib/utils/errors'

export const GET = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
    const { id } = await params

    if (!id || typeof id !== 'string') {
      throw new ValidationError('Invalid initiative ID')
    }

    const initiative = initiativeStore.get(id)
    if (!initiative) {
      throw new InitiativeNotFoundError('Initiative not found')
    }

    // Convert store initiative to full Initiative type for validation
    const mapStatus = (isActive: boolean, phase: string): InitiativeStatus => {
      if (!isActive) return InitiativeStatus.COMPLETED
      switch (phase) {
        case 'exploration': return InitiativeStatus.EXPLORING
        case 'questions': return InitiativeStatus.AWAITING_ANSWERS
        case 'research_prep': return InitiativeStatus.RESEARCHING
        case 'research_review': return InitiativeStatus.AWAITING_RESEARCH
        case 'task_generation': return InitiativeStatus.PLANNING
        case 'ready': return InitiativeStatus.READY_FOR_TASKS
        default: return InitiativeStatus.EXPLORING
      }
    }
    
    const fullInitiative: Partial<Initiative> = {
      id: initiative.id,
      objective: initiative.objective,
      status: initiative.status,
      currentPhase: initiative.currentPhase,
      createdAt: initiative.createdAt,
      updatedAt: initiative.updatedAt,
      processId: initiative.processId
    }

    // Perform general validation
    const generalValidation = validateInitiative(fullInitiative)
    
    // Perform phase-specific pre-flight checks
    const preflightValidation = performPreflightChecks(
      fullInitiative as Initiative, 
      fullInitiative.currentPhase as InitiativePhase
    )
    
    // Combine validations
    const combinedValidation = {
      valid: generalValidation.valid && preflightValidation.valid,
      errors: [...generalValidation.errors, ...preflightValidation.errors],
      warnings: [
        ...(generalValidation.warnings || []),
        ...(preflightValidation.warnings || [])
      ]
    }
    
    // Generate validation report
    const report = generateValidationReport(
      fullInitiative as Initiative,
      combinedValidation
    )
    
    return NextResponse.json({
      validation: combinedValidation,
      report,
      initiative: {
        id: initiative.id,
        phase: initiative.currentPhase,
        status: initiative.status
      }
    })
})

// Prevent static caching
export const dynamic = 'force-dynamic'