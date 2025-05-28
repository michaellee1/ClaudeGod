import { EventEmitter } from 'events'
import { ProcessManager } from './process-manager'
import initiativeStore from './initiative-store'
import { Initiative as StoreInitiative, InitiativePhase, InitiativeTaskStep } from '../types/initiative'
import { readFile } from 'fs/promises'
import { join, normalize, resolve } from 'path'
import { homedir } from 'os'
import { performPreflightChecks, validatePhaseTransition } from './initiative-validation'
import { PROMPTS } from './initiative-prompts'

interface ProcessInfo {
  initiativeId: string
  phase: InitiativePhase
  processManager: ProcessManager
  startTime: number
  timeoutId?: NodeJS.Timeout
}

interface PhaseOutput {
  type: string
  id?: string
  text?: string
  data?: any
}

const INITIATIVE_EVENTS = {
  OUTPUT: 'output',
  COMPLETED: 'completed',
  ERROR: 'error',
  TIMEOUT: 'timeout'
} as const

export class InitiativeManager extends EventEmitter {
  private static instance: InitiativeManager
  private initiativeStore = initiativeStore
  private activeProcesses: Map<string, ProcessInfo> = new Map()
  private readonly MAX_CONCURRENT_PROCESSES = 3
  private readonly PROCESS_TIMEOUT = 30 * 60 * 1000 // 30 minutes

  private constructor() {
    super()
  }

  static getInstance(): InitiativeManager {
    if (!InitiativeManager.instance) {
      InitiativeManager.instance = new InitiativeManager()
    }
    return InitiativeManager.instance
  }

  private getActiveProcessCount(): number {
    return this.activeProcesses.size
  }

  private checkResourceLimits(): void {
    if (this.getActiveProcessCount() >= this.MAX_CONCURRENT_PROCESSES) {
      throw new Error(`Resource limit reached: Maximum ${this.MAX_CONCURRENT_PROCESSES} concurrent Claude Code processes allowed`)
    }
  }

  private async loadPromptTemplate(phase: InitiativePhase): Promise<string> {
    // Use embedded prompts to avoid filesystem issues in Next.js server context
    switch (phase) {
      case InitiativePhase.EXPLORATION:
        return PROMPTS.exploration
      case InitiativePhase.RESEARCH_PREP:
        return PROMPTS.refinement
      case InitiativePhase.TASK_GENERATION:
        return PROMPTS.planning
      case InitiativePhase.QUESTIONS:
      case InitiativePhase.RESEARCH_REVIEW:
      case InitiativePhase.READY:
        throw new Error(`No template available for phase: ${phase}`)
      default:
        throw new Error(`Unknown phase: ${phase}`)
    }
  }

  private constructPrompt(template: string, initiative: StoreInitiative, context: Record<string, string> = {}): string {
    let prompt = template

    // Replace standard variables
    prompt = prompt.replace(/{{objective}}/g, initiative.objective)
    prompt = prompt.replace(/{{outputDir}}/g, this.getInitiativeDir(initiative.id))
    prompt = prompt.replace(/{{id}}/g, initiative.id)

    // Replace any additional context variables
    for (const [key, value] of Object.entries(context)) {
      const regex = new RegExp(`{{${key}}}`, 'g')
      prompt = prompt.replace(regex, value)
    }

    return prompt
  }

  private getInitiativeDir(initiativeId: string): string {
    // Validate initiative ID to prevent path traversal
    if (!this.isValidInitiativeId(initiativeId)) {
      throw new Error('Invalid initiative ID')
    }
    const safePath = normalize(join(homedir(), '.claude-god-data', 'initiatives', initiativeId))
    const baseDir = normalize(join(homedir(), '.claude-god-data', 'initiatives'))
    
    // Ensure the resolved path is within the initiatives directory
    if (!safePath.startsWith(baseDir)) {
      throw new Error('Invalid initiative path')
    }
    return safePath
  }

  private isValidInitiativeId(id: string): boolean {
    // Initiative IDs should only contain alphanumeric characters
    return /^[a-zA-Z0-9]+$/.test(id)
  }

  private async setupProcessManagerEvents(processManager: ProcessManager, processInfo: ProcessInfo): Promise<void> {
    const outputs: string[] = []

    processManager.on(INITIATIVE_EVENTS.OUTPUT, (output: PhaseOutput) => {
      outputs.push(JSON.stringify(output))
      // Broadcast output to WebSocket if available
      if ((global as any).broadcastInitiativeUpdate) {
        (global as any).broadcastInitiativeUpdate(processInfo.initiativeId, {
          type: 'output',
          phase: processInfo.phase,
          data: output
        })
      }
    })

    processManager.on(INITIATIVE_EVENTS.COMPLETED, async () => {
      try {
        // Save all outputs to phase file
        const outputContent = outputs.join('\n')
        await this.initiativeStore.savePhaseFile(
          processInfo.initiativeId,
          `${processInfo.phase}_output.json`,
          outputContent
        )

        // Process phase completion
        await this.handlePhaseCompletion(processInfo.initiativeId, processInfo.phase)

        // Cleanup
        this.cleanupProcess(processInfo.initiativeId)
      } catch (error) {
        console.error(`Error handling phase completion for ${processInfo.initiativeId}:`, error)
        this.emit(INITIATIVE_EVENTS.ERROR, { initiativeId: processInfo.initiativeId, phase: processInfo.phase, error })
      }
    })

    processManager.on(INITIATIVE_EVENTS.ERROR, (error: Error) => {
      console.error(`Process error for initiative ${processInfo.initiativeId}:`, error)
      this.cleanupProcess(processInfo.initiativeId)
      this.emit(INITIATIVE_EVENTS.ERROR, { initiativeId: processInfo.initiativeId, phase: processInfo.phase, error })
    })

    // Set up timeout
    const timeoutId = setTimeout(() => {
      if (this.activeProcesses.has(processInfo.initiativeId)) {
        console.error(`Process timeout for initiative ${processInfo.initiativeId}`)
        processManager.stopProcesses()
        this.cleanupProcess(processInfo.initiativeId)
        this.emit(INITIATIVE_EVENTS.TIMEOUT, { initiativeId: processInfo.initiativeId, phase: processInfo.phase })
      }
    }, this.PROCESS_TIMEOUT)
    
    // Store timeout ID in process info
    processInfo.timeoutId = timeoutId
  }

  private async handlePhaseCompletion(initiativeId: string, phase: InitiativePhase): Promise<void> {
    const initiative = this.initiativeStore.get(initiativeId)
    if (!initiative) {
      throw new Error(`Initiative ${initiativeId} not found`)
    }

    // Parse phase outputs and update initiative
    switch (phase) {
      case InitiativePhase.EXPLORATION:
        // Parse questions from exploration output
        const explorationOutput = await this.initiativeStore.loadPhaseFile(initiativeId, 'exploration_output.json')
        // Extract questions and save them
        await this.initiativeStore.savePhaseFile(initiativeId, 'questions.json', JSON.stringify({
          questions: this.parseQuestionsFromOutput(explorationOutput)
        }))
        // Transition to questions phase
        this.initiativeStore.updatePhase(initiativeId, 'questions')
        break

      case InitiativePhase.RESEARCH_PREP:
        // Research prep complete, transition to research_review
        this.initiativeStore.updatePhase(initiativeId, 'research_review')
        break

      case InitiativePhase.TASK_GENERATION:
        // Parse tasks from output
        const taskOutput = await this.initiativeStore.loadPhaseFile(initiativeId, 'task_generation_output.json')
        const tasks = this.parseTasksFromOutput(taskOutput)
        // Save tasks
        await this.initiativeStore.savePhaseFile(initiativeId, 'tasks.json', JSON.stringify(tasks))
        // Transition to ready
        this.initiativeStore.updatePhase(initiativeId, 'ready')
        break
    }
  }

  private parseQuestionsFromOutput(output: string): Record<string, string> {
    // Parse questions from the exploration phase output
    // This is a simplified parser - actual implementation would need to handle the specific output format
    const questions: Record<string, string> = {}
    try {
      const lines = output.split('\n').filter(line => line.trim())
      for (const line of lines) {
        try {
          const parsed: PhaseOutput = JSON.parse(line)
          if (parsed.type === 'question' && parsed.id && parsed.text) {
            questions[parsed.id] = parsed.text
          }
        } catch (lineError) {
          // Skip invalid JSON lines
          continue
        }
      }
    } catch (error) {
      console.error('Error parsing questions:', error)
    }
    return questions
  }

  private parseTasksFromOutput(output: string): InitiativeTaskStep[] {
    // Parse tasks from the task_generation phase output
    const tasks: InitiativeTaskStep[] = []
    try {
      const lines = output.split('\n').filter(line => line.trim())
      for (const line of lines) {
        try {
          const parsed: PhaseOutput = JSON.parse(line)
          if (parsed.type === 'task' && parsed.data) {
            tasks.push(parsed.data as InitiativeTaskStep)
          }
        } catch (lineError) {
          // Skip invalid JSON lines
          continue
        }
      }
    } catch (error) {
      console.error('Error parsing tasks:', error)
    }
    return tasks
  }

  async startExploration(initiativeId: string): Promise<void> {
    this.checkResourceLimits()

    const initiative = this.initiativeStore.get(initiativeId)
    if (!initiative) {
      throw new Error(`Initiative ${initiativeId} not found`)
    }

    if (initiative.currentPhase !== InitiativePhase.EXPLORATION) {
      throw new Error(`Invalid phase transition: Cannot start exploration from phase ${initiative.currentPhase}`)
    }

    // Load prompt template
    const template = await this.loadPromptTemplate(InitiativePhase.EXPLORATION)
    const prompt = this.constructPrompt(template, initiative)

    // Create process manager
    const workDir = this.getInitiativeDir(initiativeId)
    const processManager = new ProcessManager(initiativeId, workDir, process.cwd())

    // Store process info
    const processInfo: ProcessInfo = {
      initiativeId,
      phase: InitiativePhase.EXPLORATION,
      processManager,
      startTime: Date.now()
    }
    this.activeProcesses.set(initiativeId, processInfo)

    // Setup event handlers
    await this.setupProcessManagerEvents(processManager, processInfo)

    // Start the process with planning mode
    await processManager.startProcesses(workDir, prompt, initiativeId, 'planning')
  }

  async processAnswers(initiativeId: string, answers: Record<string, string>): Promise<void> {
    // Validate answers object
    if (!answers || typeof answers !== 'object') {
      throw new Error('Invalid answers: must be an object')
    }
    
    // Sanitize answer values
    const sanitizedAnswers: Record<string, string> = {}
    for (const [key, value] of Object.entries(answers)) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        throw new Error('Invalid answer format: keys and values must be strings')
      }
      sanitizedAnswers[key] = value
    }

    const initiative = this.initiativeStore.get(initiativeId)
    if (!initiative) {
      throw new Error(`Initiative ${initiativeId} not found`)
    }

    if (initiative.currentPhase !== InitiativePhase.QUESTIONS) {
      throw new Error(`Invalid phase transition: Cannot process answers from phase ${initiative.currentPhase}`)
    }

    // Save answers to file
    await this.initiativeStore.savePhaseFile(initiativeId, 'answers.json', JSON.stringify(sanitizedAnswers))

    // Start research prep phase
    this.checkResourceLimits()

    // Load prompt template and inject answers
    const template = await this.loadPromptTemplate(InitiativePhase.RESEARCH_PREP)
    const prompt = this.constructPrompt(template, initiative, {
      answers: JSON.stringify(sanitizedAnswers, null, 2)
    })

    // Update phase
    this.initiativeStore.updatePhase(initiativeId, 'research_prep')

    // Create process manager
    const workDir = this.getInitiativeDir(initiativeId)
    const processManager = new ProcessManager(initiativeId, workDir, process.cwd())

    // Store process info
    const processInfo: ProcessInfo = {
      initiativeId,
      phase: InitiativePhase.RESEARCH_PREP,
      processManager,
      startTime: Date.now()
    }
    this.activeProcesses.set(initiativeId, processInfo)

    // Setup event handlers
    await this.setupProcessManagerEvents(processManager, processInfo)

    // Start the process with planning mode
    await processManager.startProcesses(workDir, prompt, initiativeId, 'planning')
  }

  async processResearch(initiativeId: string, research: string): Promise<void> {
    // Validate research input
    if (!research || typeof research !== 'string') {
      throw new Error('Invalid research: must be a non-empty string')
    }
    
    if (research.length > 1000000) { // 1MB limit
      throw new Error('Research content too large: maximum 1MB allowed')
    }

    const initiative = this.initiativeStore.get(initiativeId)
    if (!initiative) {
      throw new Error(`Initiative ${initiativeId} not found`)
    }

    if (initiative.currentPhase !== InitiativePhase.RESEARCH_REVIEW) {
      throw new Error(`Invalid phase transition: Cannot process research from phase ${initiative.currentPhase}`)
    }

    // Validate phase transition
    const transitionError = validatePhaseTransition(
      initiative.currentPhase,
      InitiativePhase.TASK_GENERATION,
      initiative as any
    )
    if (transitionError) {
      throw new Error(`Phase transition validation failed: ${transitionError.message}`)
    }

    // Perform pre-flight checks for task generation phase
    const preflightResult = performPreflightChecks(initiative as any, InitiativePhase.TASK_GENERATION)
    if (!preflightResult.valid) {
      throw new Error(`Pre-flight check failed: ${preflightResult.errors[0]?.message || 'Unknown error'}`)
    }
    
    // Log warnings if any
    if (preflightResult.warnings && preflightResult.warnings.length > 0) {
      console.warn('[InitiativeManager] Pre-flight warnings:', preflightResult.warnings)
    }

    // Save research to file
    await this.initiativeStore.savePhaseFile(initiativeId, 'research.md', research)

    // Start task generation phase
    this.checkResourceLimits()

    // Load prompt template and inject research
    const template = await this.loadPromptTemplate(InitiativePhase.TASK_GENERATION)
    const prompt = this.constructPrompt(template, initiative, {
      research: research
    })

    // Update phase
    this.initiativeStore.updatePhase(initiativeId, 'task_generation')

    // Create process manager
    const workDir = this.getInitiativeDir(initiativeId)
    const processManager = new ProcessManager(initiativeId, workDir, process.cwd())

    // Store process info
    const processInfo: ProcessInfo = {
      initiativeId,
      phase: InitiativePhase.TASK_GENERATION,
      processManager,
      startTime: Date.now()
    }
    this.activeProcesses.set(initiativeId, processInfo)

    // Setup event handlers
    await this.setupProcessManagerEvents(processManager, processInfo)

    // Start the process with planning mode
    await processManager.startProcesses(workDir, prompt, initiativeId, 'planning')
  }

  async generateTasks(initiativeId: string): Promise<InitiativeTaskStep[]> {
    const initiative = this.initiativeStore.get(initiativeId)
    if (!initiative) {
      throw new Error(`Initiative ${initiativeId} not found`)
    }

    if (initiative.currentPhase !== InitiativePhase.READY) {
      throw new Error(`Tasks not ready: Initiative is in phase ${initiative.currentPhase}`)
    }

    // Load tasks from file
    const tasksContent = await this.initiativeStore.loadPhaseFile(initiativeId, 'tasks.json')
    return JSON.parse(tasksContent) as InitiativeTaskStep[]
  }

  private cleanupProcess(initiativeId: string): void {
    const processInfo = this.activeProcesses.get(initiativeId)
    if (processInfo) {
      // Clear timeout if exists
      if (processInfo.timeoutId) {
        clearTimeout(processInfo.timeoutId)
      }
      // Remove all listeners to prevent memory leaks
      processInfo.processManager.removeAllListeners()
      // Delete from active processes
      this.activeProcesses.delete(initiativeId)
    }
  }

  private async savePhaseOutput(initiativeId: string, phase: InitiativePhase, output: string): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `${phase}-output-${timestamp}.json`
    
    // Save output to phase directory
    await this.initiativeStore.savePhaseFile(initiativeId, filename, output)
  }

  async cleanup(): Promise<void> {
    // Clean up all active processes
    const cleanupPromises: Promise<void>[] = []
    
    for (const [initiativeId, processInfo] of Array.from(this.activeProcesses.entries())) {
      cleanupPromises.push(
        (async () => {
          try {
            await processInfo.processManager.stopProcesses()
            this.cleanupProcess(initiativeId)
          } catch (error: any) {
            console.error(`Error cleaning up process ${initiativeId}:`, error)
            this.cleanupProcess(initiativeId)
          }
        })()
      )
    }
    
    await Promise.all(cleanupPromises)
    this.removeAllListeners()
  }
}

// Add type declaration for global broadcast function
declare global {
  namespace NodeJS {
    interface Global {
      broadcastInitiativeUpdate?: (initiativeId: string, update: any) => void
    }
  }
}