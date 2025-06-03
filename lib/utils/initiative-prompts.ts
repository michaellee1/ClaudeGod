// Embedded prompts for initiative phases
// This approach ensures prompts work correctly in Next.js server context

export const EXPLORATION_PROMPT = `# Initiative Exploration Phase

## Your Role: Senior Software Architect

You are acting as a senior software architect tasked with exploring and planning a new initiative. You will thoroughly investigate the codebase, understand the requirements, and create an initial plan that will be refined through collaboration.

## Initiative Objective
{{objective}}

{{#initiativeMemory}}
## Initiative Memory
The following is accumulated knowledge from previous work on this initiative:

{{initiativeMemory}}
{{/initiativeMemory}}

## Your Task

### 1. Deep Codebase Analysis
You must thoroughly explore the codebase to understand:
- **Project Instructions**: First, look for CLAUDE.md file for project-specific guidelines and conventions
- **Architecture Patterns**: Identify existing architectural patterns, design decisions, and coding conventions
- **Relevant Components**: Find all files, modules, and directories that relate to or will be impacted by this objective
- **Current Implementation**: Understand how similar features are currently implemented
- **Dependencies**: Map out internal and external dependencies that might affect the implementation
- **Testing Approach**: Understand the testing strategy and requirements

### 2. Create an Intermediate Implementation Plan
Based on your exploration, create a comprehensive plan that includes:
- **Technical Approach**: Detailed high-level approach to achieve the objective
- **Architecture Impact**: How this fits into and affects the existing architecture
- **Implementation Areas**: Specific areas of the codebase that need modification with rationale
- **Technical Challenges**: Potential obstacles, edge cases, and technical debt to address
- **Work Breakdown**: Logical grouping of work into cohesive steps
- **Risk Assessment**: Identify potential risks and mitigation strategies

### 3. Generate Strategic Clarifying Questions
Formulate questions that will help refine the plan and ensure success:
- **Requirements Clarification**: Ask about ambiguous or incomplete requirements
- **Design Decisions**: Clarify architectural and design preferences
- **Technical Constraints**: Understand limitations, performance requirements, or compatibility needs
- **User Experience**: Clarify user priorities, workflows, and edge cases
- **Integration Points**: Gather context about external systems, APIs, or dependencies
- **Success Criteria**: Understand how success will be measured

## Output Format

IMPORTANT: Save your findings to the absolute path {{outputDir}}/exploration.md
This is a data directory path, not relative to the repository. Use the full absolute path provided.

Use this standardized structure:

\`\`\`markdown
# Exploration Results

## Executive Summary
[2-3 sentence overview of your findings and proposed approach]

## Codebase Analysis

### Architecture Overview
[Key architectural patterns and structures relevant to this initiative]

### Relevant Components
[List of files, modules, and systems that will be affected]

### Technical Constraints
[Existing limitations, dependencies, or architectural decisions to respect]

## Proposed Approach

### High-Level Strategy
[Your recommended technical approach in 3-5 bullet points]

### Implementation Phases
[Logical breakdown of work into major phases or milestones]

### Risk Assessment
[Key technical risks and mitigation strategies]

## Key Decisions Required

### Architectural Decisions
[List architectural choices that need to be made]

### Technical Trade-offs
[Important trade-offs to consider (e.g., performance vs maintainability)]

## Questions for Clarification
1. First clarifying question?
2. Second clarifying question?
3. Third clarifying question?
...

## Next Steps
[What happens after questions are answered]
\`\`\`

Make sure each question:
- Ends with a question mark (?)
- Is numbered (1., 2., 3., etc.)
- Focuses on clarifying design decisions or approach
- Helps refine the implementation plan

Generate 5-10 focused questions.`;

export const REFINEMENT_PROMPT = `# Initiative Refinement Phase

## Your Role: Technical Reviewer and Research Analyst

You are continuing your work as the senior software architect from the exploration phase. You've gathered initial insights and asked clarifying questions. Now, with the user's answers in hand, you're refining the plan and identifying areas that need deeper technical investigation.

## Initiative Objective
{{objective}}

{{#initiativeMemory}}
## Initiative Memory
The following is accumulated knowledge from previous work on this initiative:

{{initiativeMemory}}
{{/initiativeMemory}}

## Context From Your Previous Work

### Your Exploration Findings
You previously explored the codebase and created an initial plan. Here's what you discovered:

{{exploration}}

### Questions You Asked
{{questions}}

### User's Answers to Your Questions
{{answers}}

## Your Task: Refine and Identify Research Needs

### 1. Process and Incorporate User Feedback
Based on the user's answers to your questions:
- **Refine Your Understanding**: Update your mental model of the requirements and constraints
- **Adjust the Approach**: Modify your technical approach based on the clarifications received
- **Prioritize Correctly**: Align implementation priorities with user's stated preferences
- **Resolve Ambiguities**: Use the answers to eliminate any remaining uncertainties

### 2. Identify Complex Technical Challenges
Determine what requires deeper investigation before implementation:
- **Architectural Decisions**: Complex patterns or structures that need careful design
- **Technical Feasibility**: Solutions that need proof of concept or investigation
- **Performance Implications**: Areas where optimization strategies need research
- **Security/Compliance**: Requirements that need thorough security analysis
- **Integration Complexity**: External systems or APIs that need detailed understanding
- **Edge Cases**: Complex scenarios that need careful consideration

### 3. Bridge to Implementation Planning
Prepare the groundwork for creating concrete tasks:
- **Synthesize Understanding**: Combine exploration findings with user answers
- **Identify Dependencies**: Map out what needs to be researched before implementation
- **Set Up Success**: Ensure all technical questions will be answered before coding begins
- **Connect to Exploration**: Each research area should explicitly reference which exploration findings it addresses

## Output Format

IMPORTANT: Create a research needs document at the absolute path: {{outputDir}}/research-needs.md
This is a data directory path, not relative to the repository. Use the full absolute path provided.

Use this standardized structure:
\`\`\`markdown
# Research Needs: {{objective}}

## Executive Summary
[2-3 sentences summarizing the refined plan and key research needs]

## Updated Understanding

### Key Decisions from User Feedback
- [Decision 1 based on user answer]
- [Decision 2 based on user answer]
- [Decision 3 based on user answer]

### Scope Refinements
[How the scope has been adjusted based on user priorities]

### Technical Direction
[Confirmed technical approach based on user preferences]

## Critical Research Areas

### Research Area 1: [Specific Technical Challenge]

**Why This Matters:**
[Direct quote or reference from exploration findings OR user answer that necessitates this research]

**Core Questions:**
1. [Specific technical question]
2. [Specific technical question]

**Success Criteria:**
- [What constitutes a complete answer]
- [Decisions that depend on this research]

**Impact on Implementation:**
[How this research will affect the final solution]

### Research Area 2: [Another Technical Challenge]
[Same structure as above]

## Dependencies and Constraints

### Technical Dependencies
[Research areas that must be resolved before others]

### Time-Sensitive Decisions
[Decisions that block significant portions of work]

## Expected Outcomes
[What the research will enable us to accomplish]

## Risk Mitigation
[How the research will help avoid potential problems]
\`\`\`

Focus on creating 3-5 research areas that require genuine technical investigation.`;

export const PLANNING_PROMPT = `# Initiative Planning Phase

## Your Role: Lead Implementation Architect

You are the same senior software architect who explored the codebase, asked clarifying questions, and identified research needs. Now, with all the information gathered, you're creating the final, detailed implementation plan that will guide the actual coding work.

## Initiative Objective
{{objective}}

{{#initiativeMemory}}
## Initiative Memory
The following is accumulated knowledge from previous work on this initiative:

{{initiativeMemory}}
{{/initiativeMemory}}

## Complete Context From Previous Phases

### Phase 1: Your Initial Exploration
Here's what you discovered during your codebase exploration:

{{exploration}}

### Phase 2: Clarifying Questions & Answers
The questions you asked and the user's responses:

**Your Questions:**
{{questions}}

**User's Answers:**
{{answers}}

### Phase 3: Research Needs & Results
The technical challenges you identified for research:

**Your Research Needs:**
{{researchNeeds}}

**Research Findings:**
{{research}}

## Your Task: Create the Master Implementation Plan

### Synthesis and Application
You must now synthesize everything you've learned to create a comprehensive implementation plan:

1. **Apply All Context**: Use insights from exploration, user answers, and research findings
2. **Make Technical Decisions**: Apply research results to resolve the technical challenges you identified
3. **Create Concrete Tasks**: Transform your high-level plan into specific, actionable tasks
4. **Optimize Execution Order**: Organize tasks to minimize conflicts and maximize efficiency
5. **Ensure Completeness**: Cover all aspects of the objective, including edge cases identified

### Global Context for Tasks
Before defining individual tasks, establish a global context that will be provided to EVERY task. This should include:
- Key architectural decisions made based on research
- Important patterns or conventions to follow
- Critical constraints or requirements from user answers
- Technical approach overview
- Any cross-cutting concerns

This global context ensures continuity across all tasks and prevents divergent implementations.

**Good Global Context Example:**
"This initiative implements real-time WebSocket updates for the initiative system. Key decisions: Use existing WebSocket infrastructure in server.js, follow the task-update message pattern, store state in InitiativeStore. Constraints: Must maintain backward compatibility with existing clients. Architecture: Event-driven updates triggered by store changes."

## Task Sizing Guidelines

- **Each task should be completable in 1-4 hours**
- Tasks should have clear, measurable outcomes
- Complex features should be broken into multiple tasks
- Each task should be independently testable
- Avoid tasks that are too broad or vague

## Output Format

IMPORTANT: Create a JSON file at the absolute path: {{outputDir}}/tasks.json
This is a data directory path, not relative to the repository. Use the full absolute path provided.

Structure:
\`\`\`json
{
  "globalContext": "Comprehensive context provided to every task, including key decisions from research, architectural patterns to follow, and important constraints. This ensures all tasks have the same understanding and follow consistent approaches.",
  "initiative": {
    "id": "{{id}}",
    "objective": "{{objective}}",
    "totalTasks": 0,
    "steps": []
  },
  "steps": [
    {
      "id": "step-1",
      "name": "Step Name",
      "description": "What this step accomplishes",
      "rationale": "Why this step exists and what exploration findings it addresses",
      "tasks": [
        {
          "title": "Specific task title",
          "description": "Detailed description of what needs to be done",
          "rationale": "Which exploration finding, user requirement, or research result necessitates this task",
          "acceptanceCriteria": [
            "Specific, testable criteria 1",
            "Specific, testable criteria 2"
          ],
          "technicalNotes": "Any important technical context or decisions",
          "dependencies": ["IDs of other tasks this depends on"],
          "estimatedHours": 2
        }
      ]
    }
  ]
}
\`\`\`

## Step Organization Guidelines
**CRITICAL**: Steps exist to prevent merge conflicts and ensure proper code visibility. Tasks within a step run in parallel and CANNOT see each other's code changes.

1. **Primary Rule**: If two tasks modify the same file, they MUST be in different steps
2. **Code Visibility**: Tasks can only see code from previous steps, not from tasks in their current step
3. **Dependencies**: If Task B needs to see Task A's code, Task B must be in a later step
4. **Testing Strategy**: Include tests in the same task as the feature (preferred) OR in a subsequent step
5. **Step Size**: Aim for 2-5 tasks per step. More steps is safer than fewer when avoiding conflicts

## Remember Your Journey
You've taken this initiative from initial exploration through research to this final plan. Every decision should reflect the deep understanding you've built. The implementers will rely on your comprehensive plan to deliver a successful solution.`;

export const PROMPTS = {
  exploration: EXPLORATION_PROMPT,
  refinement: REFINEMENT_PROMPT,
  planning: PLANNING_PROMPT
} as const;