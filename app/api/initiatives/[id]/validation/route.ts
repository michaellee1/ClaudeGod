import { NextRequest, NextResponse } from 'next/server'
import initiativeStore from '@/lib/utils/initiative-store'
import { 
  validateInitiative, 
  performPreflightChecks,
  generateValidationReport,
  ValidationReport 
} from '@/lib/utils/initiative-validation'
import { Initiative, InitiativePhase, InitiativeStatus } from '@/lib/types/initiative'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { error: 'Invalid initiative ID' },
        { status: 400 }
      )
    }

    const initiative = initiativeStore.get(id)
    if (!initiative) {
      return NextResponse.json(
        { error: 'Initiative not found' },
        { status: 404 }
      )
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
      status: mapStatus(initiative.isActive, initiative.phase),
      currentPhase: initiative.phase as InitiativePhase,
      createdAt: initiative.createdAt,
      updatedAt: initiative.updatedAt,
      processId: initiative.claudeCodePid?.toString(),
      // Add phase-specific data
      ...(initiative.phaseData || {})
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
        phase: initiative.phase,
        status: initiative.isActive ? 'active' : 'completed'
      }
    })
  } catch (error: any) {
    console.error('Error generating validation report:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to generate validation report' },
      { status: 500 }
    )
  }
}

// Prevent static caching
export const dynamic = 'force-dynamic'