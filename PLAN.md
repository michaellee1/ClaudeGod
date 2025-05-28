# Initiative System Implementation Plan

## Global Context

This plan outlines the implementation of an Initiative System for claude-god. An initiative is a workflow tool that helps decompose larger objectives into well-planned, manageable tasks. The system guides users through a multi-phase process: exploration, Q&A, research planning, and task generation.

### Key Architecture Context

The claude-god codebase follows these patterns:
- **Task System**: Tasks are managed by TaskStore (singleton), persisted to `~/.claude-god-data/`, with phases (planner→editor→reviewer)
- **WebSocket**: Real-time updates via server.js on `/ws` endpoint with message types like `task-update`, `task-output`
- **Process Management**: ProcessManager spawns Claude Code instances with stream-JSON output parsing
- **UI**: Next.js app router with server components, Shadcn/ui components, and WebSocket hooks for real-time updates
- **Storage**: JSON persistence with in-memory Maps and debounced saves

### Initiative Workflow Phases

1. **Exploration**: Claude Code explores codebase, creates intermediate plan, generates questions
2. **Questions**: User answers high-level questions about the objective
3. **Research Prep**: Claude Code refines plan with answers, generates research needs document
4. **Research Review**: User provides research results (from Deep Research)
5. **Task Generation**: Claude Code creates detailed task breakdown with steps
6. **Ready**: Tasks ready for submission to the task system

### Technical Decisions

- Each initiative has its own directory: `~/.claude-god-data/initiatives/{id}/`
- Claude Code processes read files directly for context between phases
- Prompts are hardcoded in template files
- Submit tasks per step (not all at once)
- Default think mode: "planning" (highest level)
- Manual restart on process failures
- Manual completion of initiatives
- Initiative IDs use same format as task IDs (e.g., `0wqwnl`)
- Resource limits: max 5 concurrent initiatives, max 3 Claude Code processes
- No templates, collaboration, notifications, or export features
- Steps are UI-only with no dependency enforcement

---

## Step 1: Core Data Models and Storage Infrastructure

### Task 1.1: Create Initiative Type Definitions and Data Model

Create the TypeScript interfaces and types for the initiative system in `/lib/types/initiative.ts`. This includes the Initiative interface with all necessary fields for tracking state through the workflow phases.

**Implementation Details:**
- Create `Initiative` interface with fields: id, objective, status (exploring/awaiting_answers/researching/awaiting_research/planning/ready_for_tasks/tasks_submitted/completed), createdAt, updatedAt, currentPhase
- Create `InitiativePhase` enum for phase tracking
- Create `InitiativeQuestion` interface for storing Q&A
- Create `InitiativeResearch` interface for research needs/results
- Create `InitiativeTaskStep` interface for organizing generated tasks
- Create `InitiativeTask` interface extending the base task structure
- Add proper TypeScript exports and imports

**File Structure:**
```typescript
export interface Initiative {
  id: string
  objective: string
  status: InitiativeStatus
  currentPhase: InitiativePhase
  createdAt: Date
  updatedAt: Date
  // Phase-specific data
  questions?: InitiativeQuestion[]
  userAnswers?: Record<string, string>
  researchNeeds?: string
  researchResults?: string
  plan?: InitiativePlan
  taskSteps?: InitiativeTaskStep[]
}
```

### Task 1.2: Implement Initiative Storage Service

Create `InitiativeStore` class in `/lib/utils/initiative-store.ts` following the pattern of TaskStore. This singleton manages all initiative data with persistence to disk.

**Implementation Details:**
- Create singleton class with getInstance() method
- Implement Map-based in-memory storage for active initiatives
- Add methods: create(), get(), update(), delete(), getAll()
- Implement JSON persistence to `~/.claude-god-data/initiatives.json`
- Add debounced save functionality (1s delay)
- Create initiative directory structure on creation
- Implement file management for each phase (questions.md, answers.md, etc.)
- Add cleanup logic for deleted initiatives
- Handle concurrent access and state transitions
- Add error handling and logging
- Enforce resource limit: max 5 concurrent initiatives
- Use same ID generation as tasks (short alphanumeric)

**Key Methods:**
- `createInitiative(objective: string): Initiative`
- `updatePhase(id: string, phase: InitiativePhase, data: any): void`
- `savePhaseFile(id: string, filename: string, content: string): void`
- `loadPhaseFile(id: string, filename: string): string`

### Task 1.3: Extend Task Model for Initiative Integration

Modify the existing Task interface to support initiative linkage and add necessary fields for tracking initiative-generated tasks.

**Implementation Details:**
- Add `initiativeId?: string` field to Task interface in `/lib/types/task.ts`
- Add `stepNumber?: number` field for step organization
- Add `globalContext?: string` field for initiative-wide context
- Update TaskStore to handle initiative-linked tasks
- Add method to TaskStore: `getTasksByInitiative(initiativeId: string)`
- Ensure backward compatibility with existing tasks
- Update task creation logic to accept initiative parameters

---

## Step 2: Initiative Management Service and Process Coordination

### Task 2.1: Create Initiative Manager Service

Implement the core InitiativeManager service in `/lib/utils/initiative-manager.ts` that coordinates the entire initiative workflow and manages Claude Code processes.

**Implementation Details:**
- Create class to manage initiative lifecycle and phase transitions
- Implement phase transition methods with validation
- Add Claude Code process spawning for each phase
- Implement prompt construction with context injection
- Add error handling and recovery mechanisms
- Create methods for each phase:
  - `startExploration(initiativeId: string): void`
  - `processAnswers(initiativeId: string, answers: Record<string, string>): void`
  - `processResearch(initiativeId: string, research: string): void`
  - `generateTasks(initiativeId: string): InitiativeTaskStep[]`
- Add process monitoring and output capture
- Implement timeout handling (30 min per process)
- Add cleanup for failed processes
- Enforce resource limit: max 3 concurrent Claude Code processes
- Enable inter-phase communication via file writing/reading

**Process Coordination:**
- Each phase spawns a new Claude Code process
- Previous phase outputs are read from files
- Process outputs are parsed and saved to appropriate files
- State transitions happen after successful process completion

### Task 2.2: Create Claude Code Prompt Templates

Create template files for each initiative phase in `/lib/prompts/initiative/`. These templates guide Claude Code through each phase of the initiative workflow.

**Implementation Details:**
- Create `/lib/prompts/initiative/exploration.md`:
  - Instructions for codebase exploration
  - Context about finding CLAUDE.md and existing patterns
  - Output format for intermediate plan and questions
- Create `/lib/prompts/initiative/refinement.md`:
  - Instructions for incorporating user answers
  - Context about previous exploration
  - Output format for research needs document
- Create `/lib/prompts/initiative/planning.md`:
  - Instructions for final task breakdown
  - Context about all previous phases
  - JSON output format for tasks and steps
- Add template variable placeholders: {{objective}}, {{previousOutput}}, etc.
- Include specific instructions about output file locations
- Add guidance on task sizing and step organization

**Template Structure Example:**
```markdown
# Initiative Planning Phase

You are helping plan an initiative with the following objective:
{{objective}}

Previous exploration and research:
{{previousContext}}

Your task is to create a detailed implementation plan...
```

### Task 2.3: Implement Process Output Parsers

Create parsing utilities in `/lib/utils/initiative-parsers.ts` to handle Claude Code outputs from each phase.

**Implementation Details:**
- Create parser for exploration phase output (extract questions from markdown)
- Create parser for research needs document
- Create parser for final task JSON output
- Implement robust error handling for malformed outputs
- Add validation for required fields
- Create helper functions:
  - `parseQuestions(content: string): InitiativeQuestion[]`
  - `parseTaskPlan(content: string): { globalContext: string, steps: InitiativeTaskStep[] }`
- Handle edge cases like empty outputs or partial completions
- Add logging for debugging parse failures

---

## Step 3: API Routes and WebSocket Integration

### Task 3.1: Create Initiative API Routes

Implement REST API endpoints for initiative management in `/app/api/initiatives/`.

**Implementation Details:**
- Create `POST /api/initiatives` - Create new initiative
  - Accept objective in request body
  - Create initiative and start exploration phase
  - Return initiative ID and status
- Create `GET /api/initiatives` - List all initiatives
  - Return array of initiatives with current status
  - Include phase information and progress
- Create `GET /api/initiatives/[id]` - Get initiative details
  - Return full initiative data including phase files
- Create `POST /api/initiatives/[id]/answers` - Submit answers
  - Accept answers object in request body
  - Trigger refinement phase
- Create `POST /api/initiatives/[id]/research` - Submit research
  - Accept research text in request body
  - Trigger planning phase
- Create `POST /api/initiatives/[id]/tasks` - Convert to tasks
  - Accept step number and task selections
  - Create actual tasks in task system
- Add proper error handling and validation
- Implement authorization checks if needed

### Task 3.2: Add WebSocket Events for Initiative Updates

Extend the WebSocket server to support initiative-specific events for real-time updates.

**Implementation Details:**
- Add new message types to WebSocket server:
  - `initiative-update` - Status/phase changes
  - `initiative-output` - Claude Code process outputs
  - `initiative-removed` - Initiative deletion
- Modify server.js to handle initiative subscriptions
- Add broadcast functions:
  - `broadcastInitiativeUpdate(initiative)`
  - `broadcastInitiativeOutput(initiativeId, output)`
- Create initiative-specific rooms/channels
- Update client WebSocket hook to handle new message types
- Add initiative subscription management
- Ensure proper cleanup on disconnect

### Task 3.3: Create Initiative WebSocket Hook

Create a custom React hook for initiative WebSocket subscriptions in `/lib/hooks/useInitiativeWebSocket.ts`.

**Implementation Details:**
- Create hook following useWebSocket pattern
- Add initiative-specific subscription logic
- Handle connection management and reconnection
- Implement message handlers for each event type
- Add state management for initiative updates
- Create helper methods:
  - `subscribeToInitiative(initiativeId: string)`
  - `unsubscribeFromInitiative(initiativeId: string)`
- Handle real-time output streaming
- Add error handling and recovery

---

## Step 4: UI Components for Initiative Workflow

### Task 4.1: Create Initiative List Page

Implement the initiatives overview page at `/app/initiatives/page.tsx` showing all initiatives with their status.

**Implementation Details:**
- Create server component with data fetching
- Implement table view with columns:
  - Objective (truncated with tooltip)
  - Status badge with color coding
  - Current phase indicator
  - Created date
  - Actions (View, Delete, Complete)
- Add "New Initiative" button with modal dialog
- Implement initiative creation form
- Add real-time updates via WebSocket
- Implement delete confirmation dialog
- Add manual "Complete" button for initiatives
- Add responsive design for mobile
- Include loading and error states

**UI Components:**
- Use Shadcn Table component
- Status badges with appropriate colors
- Dialog for new initiative creation
- Confirmation dialogs for destructive actions

### Task 4.2: Create Initiative Detail Page

Build the initiative detail page at `/app/initiative/[id]/page.tsx` that guides users through the workflow.

**Implementation Details:**
- Create dynamic route with initiative ID parameter
- Implement phase-specific UI sections:
  - **Exploration**: Show progress, spinner during processing
  - **Questions**: Display all questions with answer text areas
  - **Research Prep**: Show research needs with copy button
  - **Research Input**: Large text area for pasting research
  - **Task Preview**: Grid/table of generated tasks by step
- Add WebSocket integration for real-time updates
- Implement phase transition handling
- Add breadcrumb navigation
- Create collapsible sections for completed phases
- Add "View Files" option to see raw phase outputs
- Implement error states and retry mechanisms
- Add loading states for each phase

**Phase-Specific Components:**
- Question/Answer form with submit button
- Research needs display with copy-to-clipboard
- Task preview with step organization
- Submit buttons for each step

### Task 4.3: Create Task Preview and Submission Component

Build a reusable component for previewing and submitting initiative-generated tasks in `/components/InitiativeTaskPreview.tsx`.

**Implementation Details:**
- Create component accepting task steps as props
- Implement step-based organization with cards/sections
- Display global context at the top
- Show tasks grouped by step number
- Add task removal functionality (no checkbox selection needed)
- Add think mode selector per step (default: "planning")
- Create "Submit Step" button for each step
- Show submission progress and status
- Handle submission errors gracefully
- Add task count indicators
- Implement responsive grid layout
- Add expand/collapse for long task descriptions
- No task reordering between steps

**Features:**
- Simple task removal with delete button
- Preview of task details on hover/click
- Progress tracking during submission
- Step-by-step submission workflow

### Task 4.4: Create Initiative Status Component

Build a reusable status display component in `/components/InitiativeStatus.tsx` for showing initiative progress.

**Implementation Details:**
- Create visual progress indicator (stepper or timeline)
- Show all phases with completion status
- Highlight current active phase
- Add time estimates for each phase
- Include phase descriptions on hover
- Add retry button for failed phases
- Show phase outputs summary
- Implement responsive design
- Add animation for phase transitions
- Include error state displays

---

## Step 5: Claude Code Integration and Process Management

### Task 5.1: Extend Process Manager for Initiative Support

Modify ProcessManager to handle initiative-specific Claude Code processes with appropriate prompts and context.

**Implementation Details:**
- Add initiative-specific process spawning methods
- Implement prompt template loading and variable substitution
- Add file path injection for context reading
- Modify output handling for different phase formats
- Add phase-specific timeout configurations
- Implement better error messages for initiative processes
- Add process metadata for tracking
- Create methods:
  - `runInitiativeExploration(initiative: Initiative): Promise<void>`
  - `runInitiativeRefinement(initiative: Initiative): Promise<void>`
  - `runInitiativePlanning(initiative: Initiative): Promise<void>`
- Handle process cleanup on failure
- Add logging for debugging

### Task 5.2: Implement Initiative File Management

Create utilities for managing initiative file structure and content in `/lib/utils/initiative-files.ts`.

**Implementation Details:**
- Create helper functions for file operations:
  - `getInitiativeDir(id: string): string`
  - `ensureInitiativeDirectory(id: string): void`
  - `saveQuestions(id: string, questions: InitiativeQuestion[]): void`
  - `saveAnswers(id: string, answers: Record<string, string>): void`
  - `saveResearchNeeds(id: string, content: string): void`
  - `saveResearchResults(id: string, content: string): void`
  - `savePlan(id: string, plan: any): void`
  - `loadAllPhaseFiles(id: string): InitiativeContext`
- Implement atomic writes for data consistency
- Add file locking if needed
- Create backup mechanisms for important files
- Handle file permissions and errors
- Add content validation before saving

### Task 5.3: Create Initiative Background Processor

Implement a background service in `/lib/utils/initiative-processor.ts` that monitors and manages long-running initiative processes.

**Implementation Details:**
- Create service to monitor active initiative processes
- Implement health checks for running processes
- Manual retry only (no automatic retry)
- Create process queue for sequential execution
- Implement graceful shutdown handling
- Add metrics and logging
- Create recovery mechanisms for interrupted processes
- Handle system resource constraints (max 3 processes)
- Add methods:
  - `queueInitiativePhase(initiativeId: string, phase: InitiativePhase): void`
  - `retryFailedPhase(initiativeId: string): void`
  - `cancelActiveProcess(initiativeId: string): void`
- Integrate with WebSocket for status updates

---

## Step 6: Testing, Error Handling, and Polish

### Task 6.1: Implement Comprehensive Error Handling

Add robust error handling throughout the initiative system with user-friendly error messages and recovery options.

**Implementation Details:**
- Create custom error classes for initiative-specific errors
- Add error boundaries for UI components
- Implement graceful degradation for feature failures
- Create user-friendly error messages
- Add automatic error reporting/logging
- Implement retry mechanisms with exponential backoff
- Add rollback capabilities for failed operations
- Create error recovery workflows
- Handle edge cases:
  - Network failures during API calls
  - Process crashes during execution
  - Malformed Claude Code outputs
  - File system errors
  - Concurrent modification conflicts
- Add telemetry for error tracking

### Task 6.2: Add Initiative System Validation

Create validation utilities and integrate them throughout the system to ensure data integrity.

**Implementation Details:**
- Create validation schemas for all data types
- Add input validation for API endpoints
- Implement output validation for Claude Code processes
- Add file content validation
- Create pre-flight checks for each phase
- Implement data migration for schema changes
- Add validation for:
  - Objective length and content
  - Answer completeness
  - Research content size limits
  - Generated task validity
  - File system constraints
- Create validation report tools
- Add user warnings for potential issues

### Task 6.3: Create Initiative Documentation and Help System

Build user-facing documentation and in-app help for the initiative system.

**Implementation Details:**
- Create `/docs/INITIATIVES.md` with full system documentation
- Add tooltips throughout the UI explaining each phase
- Add help modal in initiative UI
- Document best practices for:
  - Writing clear objectives
  - Answering exploration questions
  - Conducting research
  - Reviewing generated tasks
- Add FAQ section
- Create troubleshooting guide
- Include API documentation for developers

### Task 6.4: Polish UI/UX and Add Final Features

Implement final UI polish, animations, and quality-of-life features for the initiative system.

**Implementation Details:**
- Add smooth transitions between phases
- Implement skeleton loaders during data fetching
- Add success animations for phase completions
- Create keyboard navigation support
- Implement dark mode support
- Add initiative templates for common objectives
- Create initiative duplication feature
- Add export functionality for initiative data
- Implement search and filtering
- Add batch operations for initiatives
- Create initiative archiving (vs deletion)
- Add performance optimizations
- Implement accessibility features (ARIA labels, etc.)
- Add initiative sharing capabilities (if needed)
- Create mobile-responsive optimizations

**Polish Items:**
- Consistent loading states
- Smooth animations
- Helpful empty states
- Clear CTAs for each phase
- Progress persistence across sessions