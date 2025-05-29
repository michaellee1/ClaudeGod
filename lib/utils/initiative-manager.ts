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

  private async constructPrompt(template: string, initiative: StoreInitiative, context: Record<string, string> = {}): Promise<string> {
    let prompt = template

    // Replace standard variables
    prompt = prompt.replace(/{{objective}}/g, initiative.objective)
    prompt = prompt.replace(/{{outputDir}}/g, this.getInitiativeDir(initiative.id))
    prompt = prompt.replace(/{{id}}/g, initiative.id)

    // Build cumulative context from all previous phases
    const cumulativeContext: Record<string, string> = { ...context }
    
    try {
      // Always include INITIATIVE.md if it exists - this is the memory file
      if (await this.phaseFileExists(initiative.id, 'INITIATIVE.md')) {
        const initiativeMemory = await this.initiativeStore.loadPhaseFile(initiative.id, 'INITIATIVE.md')
        cumulativeContext.initiativeMemory = initiativeMemory
      }
      
      // Load exploration output if it exists
      if (await this.phaseFileExists(initiative.id, 'exploration_output.json')) {
        const explorationOutput = await this.initiativeStore.loadPhaseFile(initiative.id, 'exploration_output.json')
        const explorationContent = this.extractContentFromOutput(explorationOutput)
        if (explorationContent) {
          cumulativeContext.exploration = explorationContent
        }
      }

      // Load questions if they exist
      if (await this.phaseFileExists(initiative.id, 'questions.json')) {
        const questions = await this.initiativeStore.loadPhaseFile(initiative.id, 'questions.json')
        cumulativeContext.questions = questions
      }

      // Load answers if they exist
      if (await this.phaseFileExists(initiative.id, 'answers.json')) {
        const answers = await this.initiativeStore.loadPhaseFile(initiative.id, 'answers.json')
        cumulativeContext.answers = answers
      }

      // Load research needs if they exist
      if (await this.phaseFileExists(initiative.id, 'research-needs.md')) {
        const researchNeeds = await this.initiativeStore.loadPhaseFile(initiative.id, 'research-needs.md')
        cumulativeContext.researchNeeds = researchNeeds
      }

      // Load research if it exists (and not already in context)
      if (!cumulativeContext.research && await this.phaseFileExists(initiative.id, 'research.md')) {
        const research = await this.initiativeStore.loadPhaseFile(initiative.id, 'research.md')
        cumulativeContext.research = research
      }
    } catch (error) {
      console.error('Error loading cumulative context:', error)
    }

    // Replace all context variables
    for (const [key, value] of Object.entries(cumulativeContext)) {
      const regex = new RegExp(`{{${key}}}`, 'g')
      prompt = prompt.replace(regex, value)
    }

    // Handle conditional sections (e.g., {{#initiativeMemory}}...{{/initiativeMemory}})
    for (const [key, value] of Object.entries(cumulativeContext)) {
      const conditionalRegex = new RegExp(`{{#${key}}}([\\s\\S]*?){{/${key}}}`, 'g')
      if (value) {
        // Replace the conditional markers but keep the content
        prompt = prompt.replace(conditionalRegex, '$1')
      } else {
        // Remove the entire conditional section if value is empty
        prompt = prompt.replace(conditionalRegex, '')
      }
    }

    return prompt
  }

  private extractContentFromOutput(output: string): string {
    try {
      let content = ''
      const lines = output.split('\n').filter(line => line.trim())
      
      for (const line of lines) {
        try {
          const parsed: PhaseOutput = JSON.parse(line)
          if (parsed.type === 'output' && parsed.data) {
            content += parsed.data + '\n'
          }
        } catch {
          content += line + '\n'
        }
      }
      
      return content.trim()
    } catch (error) {
      console.error('Error extracting content from output:', error)
      return ''
    }
  }

  private async phaseFileExists(initiativeId: string, filename: string): Promise<boolean> {
    try {
      await this.initiativeStore.loadPhaseFile(initiativeId, filename)
      return true
    } catch {
      return false
    }
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

    // Listen to the raw output from process manager
    processManager.on('output', (output: any) => {
      // Store output as JSON line
      const phaseOutput: PhaseOutput = {
        type: 'output',
        data: typeof output === 'string' ? output : JSON.stringify(output)
      }
      outputs.push(JSON.stringify(phaseOutput))
      
      // Broadcast output to WebSocket if available
      if ((global as any).broadcastInitiativeOutput) {
        (global as any).broadcastInitiativeOutput(processInfo.initiativeId, {
          type: 'output',
          phase: processInfo.phase,
          data: output,
          timestamp: new Date()
        })
      }
    })

    processManager.on('completed', async () => {
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
        await this.cleanupProcess(processInfo.initiativeId)
      } catch (error) {
        console.error(`Error handling phase completion for ${processInfo.initiativeId}:`, error)
        this.emit(INITIATIVE_EVENTS.ERROR, { initiativeId: processInfo.initiativeId, phase: processInfo.phase, error })
      }
    })

    processManager.on('error', async (error: Error) => {
      console.error(`Process error for initiative ${processInfo.initiativeId}:`, error)
      await this.cleanupProcess(processInfo.initiativeId)
      this.emit(INITIATIVE_EVENTS.ERROR, { initiativeId: processInfo.initiativeId, phase: processInfo.phase, error })
    })

    // Set up timeout
    const timeoutId = setTimeout(async () => {
      if (this.activeProcesses.has(processInfo.initiativeId)) {
        console.error(`Process timeout for initiative ${processInfo.initiativeId}`)
        processManager.stopProcesses()
        await this.cleanupProcess(processInfo.initiativeId)
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

    // Update INITIATIVE.md with phase results
    await this.updateInitiativeMemory(initiativeId, phase)

    // Parse phase outputs and update initiative
    switch (phase) {
      case InitiativePhase.EXPLORATION:
        // Parse questions from exploration output
        const explorationOutput = await this.initiativeStore.loadPhaseFile(initiativeId, 'exploration_output.json')
        const questions = this.parseQuestionsFromOutput(explorationOutput)
        // Save questions in the expected format
        await this.initiativeStore.savePhaseFile(initiativeId, 'questions.json', JSON.stringify(questions))
        // Also save the raw markdown output for reference
        const markdownQuestions = Object.entries(questions).map(([id, q]) => `${id}: ${q}`).join('\n')
        await this.initiativeStore.savePhaseFile(initiativeId, 'questions.md', markdownQuestions)
        // Transition to questions phase
        await this.initiativeStore.updatePhase(initiativeId, 'questions')
        break

      case InitiativePhase.RESEARCH_PREP:
        // Extract research needs from output
        const researchOutput = await this.initiativeStore.loadPhaseFile(initiativeId, 'research_prep_output.json')
        let researchNeeds = ''
        try {
          const lines = researchOutput.split('\n').filter(line => line.trim())
          for (const line of lines) {
            try {
              const parsed: PhaseOutput = JSON.parse(line)
              if (parsed.type === 'output' && parsed.data) {
                researchNeeds += parsed.data + '\n'
              }
            } catch {
              researchNeeds += line + '\n'
            }
          }
        } catch (error) {
          console.error('Error extracting research needs:', error)
        }
        // Save research needs
        await this.initiativeStore.savePhaseFile(initiativeId, 'research-needs.md', researchNeeds.trim())
        // Research prep complete, transition to research_review
        await this.initiativeStore.updatePhase(initiativeId, 'research_review')
        break

      case InitiativePhase.TASK_GENERATION:
        // Parse tasks from output
        const taskOutput = await this.initiativeStore.loadPhaseFile(initiativeId, 'task_generation_output.json')
        const tasks = this.parseTasksFromOutput(taskOutput)
        // Also extract global context
        let globalContext = ''
        try {
          let jsonContent = ''
          const lines = taskOutput.split('\n').filter(line => line.trim())
          for (const line of lines) {
            try {
              const parsed: PhaseOutput = JSON.parse(line)
              if (parsed.type === 'output' && parsed.data) {
                jsonContent += parsed.data + '\n'
              }
            } catch {
              jsonContent += line + '\n'
            }
          }
          const { parseTaskPlan } = require('./initiative-parsers')
          const taskPlan = parseTaskPlan(jsonContent)
          globalContext = taskPlan.globalContext || ''
        } catch (error) {
          console.error('Error extracting global context:', error)
        }
        // Save tasks with proper structure
        await this.initiativeStore.savePhaseFile(initiativeId, 'tasks.json', JSON.stringify({
          globalContext,
          steps: tasks
        }))
        // Update initiative with task steps
        await this.initiativeStore.update(initiativeId, {
          taskSteps: tasks
        })
        // Transition to ready
        await this.initiativeStore.updatePhase(initiativeId, 'ready')
        break
    }
  }

  private parseQuestionsFromOutput(output: string): Record<string, string> {
    // Parse questions from the exploration phase output
    // First try to extract the actual content from the JSON output
    const questions: Record<string, string> = {}
    try {
      // Extract the markdown content from the output
      let markdownContent = ''
      const lines = output.split('\n').filter(line => line.trim())
      
      for (const line of lines) {
        try {
          const parsed: PhaseOutput = JSON.parse(line)
          if (parsed.type === 'output' && parsed.data) {
            markdownContent += parsed.data + '\n'
          }
        } catch (lineError) {
          // Not JSON, might be raw output
          markdownContent += line + '\n'
        }
      }
      
      // Now parse questions from the markdown content
      const { parseQuestions } = require('./initiative-parsers')
      const parsedQuestions = parseQuestions(markdownContent)
      
      // Convert to the expected format
      parsedQuestions.forEach((q: any) => {
        questions[q.id] = q.question
      })
    } catch (error) {
      console.error('Error parsing questions:', error)
    }
    return questions
  }

  private parseTasksFromOutput(output: string): InitiativeTaskStep[] {
    // Parse tasks from the task_generation phase output
    try {
      // Extract the JSON content from the output
      let jsonContent = ''
      const lines = output.split('\n').filter(line => line.trim())
      
      for (const line of lines) {
        try {
          const parsed: PhaseOutput = JSON.parse(line)
          if (parsed.type === 'output' && parsed.data) {
            jsonContent += parsed.data + '\n'
          }
        } catch (lineError) {
          // Not JSON, might be raw output
          jsonContent += line + '\n'
        }
      }
      
      // Now parse tasks from the JSON content
      const { parseTaskPlan } = require('./initiative-parsers')
      const taskPlan = parseTaskPlan(jsonContent)
      
      return taskPlan.steps || []
    } catch (error) {
      console.error('Error parsing tasks:', error)
      return []
    }
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
    const prompt = await this.constructPrompt(template, initiative)

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
    const { plannerPid } = await processManager.startProcesses(workDir, prompt, initiativeId, 'planning')
    
    // Update initiative with process ID
    await this.initiativeStore.update(initiativeId, {
      processId: String(plannerPid),
      isActive: true
    })
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
    const prompt = await this.constructPrompt(template, initiative, {
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
    const { plannerPid } = await processManager.startProcesses(workDir, prompt, initiativeId, 'planning')
    
    // Update initiative with process ID
    await this.initiativeStore.update(initiativeId, {
      processId: String(plannerPid),
      isActive: true
    })
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
    const prompt = await this.constructPrompt(template, initiative, {
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
    const { plannerPid } = await processManager.startProcesses(workDir, prompt, initiativeId, 'planning')
    
    // Update initiative with process ID
    await this.initiativeStore.update(initiativeId, {
      processId: String(plannerPid),
      isActive: true
    })
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
    try {
      const tasksContent = await this.initiativeStore.loadPhaseFile(initiativeId, 'tasks.json')
      const parsed = JSON.parse(tasksContent)
      
      // Handle both formats: array of steps or object with steps property
      if (Array.isArray(parsed)) {
        return parsed as InitiativeTaskStep[]
      } else if (parsed.steps && Array.isArray(parsed.steps)) {
        return parsed.steps as InitiativeTaskStep[]
      } else {
        console.error('Invalid tasks format:', parsed)
        return []
      }
    } catch (error) {
      console.error(`Error loading tasks for initiative ${initiativeId}:`, error)
      // Try to get from initiative object
      return initiative.taskSteps || []
    }
  }

  private async cleanupProcess(initiativeId: string): Promise<void> {
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
    
    // Clear process ID and active flag from initiative store
    try {
      await this.initiativeStore.update(initiativeId, {
        processId: undefined,
        isActive: false
      })
    } catch (error) {
      console.error(`Error clearing process info for initiative ${initiativeId}:`, error)
    }
  }

  private async updateInitiativeMemory(initiativeId: string, completedPhase: InitiativePhase): Promise<void> {
    try {
      // Load existing INITIATIVE.md or create new content
      let memoryContent = ''
      try {
        memoryContent = await this.initiativeStore.loadPhaseFile(initiativeId, 'INITIATIVE.md')
      } catch {
        // File doesn't exist yet, create initial content
        const initiative = this.initiativeStore.get(initiativeId)
        if (!initiative) return
        
        memoryContent = `# Initiative Memory: ${initiative.objective}

**Initiative ID:** ${initiativeId}  
**Created:** ${new Date().toISOString()}  
**Status:** In Progress

## Objective
${initiative.objective}

## Key Decisions and Constraints

## Phase Progress
`
      }

      // Extract key information from the completed phase
      const phaseUpdate = await this.extractPhaseKeyInfo(initiativeId, completedPhase)
      
      // Append phase update to memory
      const timestamp = new Date().toISOString()
      memoryContent += `\n### ${this.getPhaseDisplayName(completedPhase)} - ${timestamp}\n${phaseUpdate}\n`

      // Save updated memory file
      await this.initiativeStore.savePhaseFile(initiativeId, 'INITIATIVE.md', memoryContent)
    } catch (error) {
      console.error(`Error updating initiative memory for ${initiativeId}:`, error)
      // Don't throw - this is supplementary functionality
    }
  }

  private async extractPhaseKeyInfo(initiativeId: string, phase: InitiativePhase): Promise<string> {
    try {
      switch (phase) {
        case InitiativePhase.EXPLORATION:
          const explorationContent = await this.loadPhaseContent(initiativeId, 'exploration.md')
          return this.extractExplorationKeyInfo(explorationContent)
          
        case InitiativePhase.RESEARCH_PREP:
          const researchNeeds = await this.loadPhaseContent(initiativeId, 'research-needs.md')
          const answers = await this.loadPhaseContent(initiativeId, 'answers.json')
          return this.extractRefinementKeyInfo(researchNeeds, answers)
          
        case InitiativePhase.TASK_GENERATION:
          const tasks = await this.loadPhaseContent(initiativeId, 'tasks.json')
          return this.extractPlanningKeyInfo(tasks)
          
        default:
          return `Phase ${phase} completed.`
      }
    } catch (error) {
      return `Phase ${phase} completed (details unavailable).`
    }
  }

  private async loadPhaseContent(initiativeId: string, filename: string): Promise<string> {
    try {
      if (filename.endsWith('_output.json')) {
        const output = await this.initiativeStore.loadPhaseFile(initiativeId, filename)
        return this.extractContentFromOutput(output)
      }
      return await this.initiativeStore.loadPhaseFile(initiativeId, filename)
    } catch {
      return ''
    }
  }

  private extractExplorationKeyInfo(content: string): string {
    const lines = content.split('\n')
    let keyInfo = '**Key Findings:**\n'
    let inImportantSection = false
    let bulletPoints: string[] = []
    
    for (const line of lines) {
      // Look for key sections
      if (line.includes('## Context') || line.includes('## Intermediate Plan')) {
        inImportantSection = true
      } else if (line.startsWith('## Questions')) {
        inImportantSection = false
      }
      
      // Extract bullet points from important sections
      if (inImportantSection && line.trim().startsWith('-')) {
        bulletPoints.push(line.trim())
      }
    }
    
    // Take first 5 most important points
    keyInfo += bulletPoints.slice(0, 5).join('\n')
    
    return keyInfo
  }

  private extractRefinementKeyInfo(researchNeeds: string, answersJson: string): string {
    let keyInfo = '**Key Decisions from User Feedback:**\n'
    
    try {
      const answers = JSON.parse(answersJson)
      // Extract key answers that indicate decisions
      const decisions = Object.entries(answers)
        .filter(([_, answer]) => answer && typeof answer === 'string' && answer.length > 20)
        .slice(0, 3)
        .map(([question, answer]) => `- ${question}: ${answer}`)
      
      keyInfo += decisions.join('\n')
    } catch {
      keyInfo += '- User feedback incorporated into plan'
    }
    
    keyInfo += '\n\n**Research Areas Identified:**\n'
    const researchTopics = researchNeeds.match(/### Topic \d+: (.+)/g) || []
    keyInfo += researchTopics.slice(0, 3).map(topic => `- ${topic.replace(/### Topic \d+: /, '')}`).join('\n')
    
    return keyInfo
  }

  private extractPlanningKeyInfo(tasksJson: string): string {
    let keyInfo = '**Implementation Plan:**\n'
    
    try {
      const taskData = JSON.parse(tasksJson)
      
      // Extract global context key points
      if (taskData.globalContext) {
        keyInfo += '\n**Global Architecture Decisions:**\n'
        const contextLines = taskData.globalContext.split('\n').filter((line: string) => line.trim())
        keyInfo += contextLines.slice(0, 3).map((line: string) => `- ${line.trim()}`).join('\n')
      }
      
      // Extract step summary
      if (taskData.steps && Array.isArray(taskData.steps)) {
        keyInfo += '\n\n**Implementation Steps:**\n'
        keyInfo += taskData.steps.map((step: any, index: number) => 
          `${index + 1}. ${step.name} (${step.tasks?.length || 0} tasks)`
        ).join('\n')
      }
    } catch {
      keyInfo += '- Detailed task breakdown created'
    }
    
    return keyInfo
  }

  private getPhaseDisplayName(phase: InitiativePhase): string {
    const displayNames: Record<InitiativePhase, string> = {
      [InitiativePhase.EXPLORATION]: 'Exploration Phase',
      [InitiativePhase.QUESTIONS]: 'Questions Phase',
      [InitiativePhase.RESEARCH_PREP]: 'Refinement Phase',
      [InitiativePhase.RESEARCH_REVIEW]: 'Research Review',
      [InitiativePhase.TASK_GENERATION]: 'Planning Phase',
      [InitiativePhase.READY]: 'Ready for Implementation'
    }
    return displayNames[phase] || phase
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
            await this.cleanupProcess(initiativeId)
          } catch (error: any) {
            console.error(`Error cleaning up process ${initiativeId}:`, error)
            await this.cleanupProcess(initiativeId)
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