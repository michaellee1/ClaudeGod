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

Save your findings to {{outputDir}}/exploration.md with the following structure:

```markdown
# Exploration Results

## Context
Brief summary of relevant codebase understanding

## Intermediate Plan
High-level approach and work breakdown

## Questions
1. First clarifying question?
2. Second clarifying question?
3. Third clarifying question?
...
```

Make sure each question:
- Ends with a question mark (?)
- Is numbered (1., 2., 3., etc.)
- Focuses on clarifying design decisions or approach
- Helps refine the implementation plan

Generate 5-10 focused questions.

## Important Notes

- Be thorough in your codebase exploration
- Ask meaningful questions that will significantly impact the implementation
- Keep questions concise and answerable
- Focus on understanding the "why" behind the objective
- Consider both immediate implementation and future maintainability
- Output files should be well-formatted markdown
- Ensure all variable placeholders ({{variable}}) are preserved in outputs