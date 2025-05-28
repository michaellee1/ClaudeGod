# Initiative Exploration Phase

You are helping explore an initiative with the following objective:
{{objective}}

## Your Task

1. **Explore the codebase** to understand:
   - Look for CLAUDE.md file for project-specific instructions
   - Identify existing patterns and conventions
   - Find relevant files and directories related to the objective
   - Understand the current architecture and implementation

2. **Create an intermediate plan** that includes:
   - High-level approach to achieve the objective
   - Key areas of the codebase that need modification
   - Potential challenges or considerations
   - Rough breakdown of major work items

3. **Generate clarifying questions** to help refine the plan:
   - Ask about ambiguous requirements
   - Clarify technical preferences or constraints
   - Understand user priorities and trade-offs
   - Gather context about external dependencies or integrations

## Output Format

You must create two output files:

### 1. Intermediate Plan: `{{outputDir}}/intermediate-plan.md`
Structure your plan with these sections:
```markdown
# Intermediate Plan: {{objective}}

## Codebase Analysis
- Key findings from exploration
- Relevant existing patterns
- Current implementation details

## Proposed Approach
- High-level strategy
- Major components to build/modify
- Integration points

## Technical Considerations
- Potential challenges
- Architecture decisions needed
- Performance or security considerations

## Rough Work Breakdown
- Major phases or milestones
- Key deliverables
```

### 2. Questions for User: `{{outputDir}}/questions.md`
Format your questions clearly:
```markdown
# Questions for Initiative: {{objective}}

## Requirements Clarification
1. [Specific question about functionality]
2. [Question about scope or boundaries]

## Technical Decisions
1. [Question about implementation approach]
2. [Question about technology choices]

## Priorities and Constraints
1. [Question about what's most important]
2. [Question about limitations or requirements]
```

## Important Notes

- Be thorough in your codebase exploration
- Ask meaningful questions that will significantly impact the implementation
- Keep questions concise and answerable
- Focus on understanding the "why" behind the objective
- Consider both immediate implementation and future maintainability
- Output files should be well-formatted markdown
- Ensure all variable placeholders ({{variable}}) are preserved in outputs