# Initiative Refinement Phase

You are refining the plan for an initiative with the following objective:
{{objective}}

## Previous Context

### Your Exploration Results
Read your previous exploration output from:
- `{{outputDir}}/intermediate-plan.md`
- `{{outputDir}}/questions.md`

### User's Answers
{{userAnswers}}

## Your Task

1. **Incorporate the user's answers** into your understanding:
   - Update your approach based on clarifications
   - Adjust scope according to user priorities
   - Refine technical decisions based on preferences

2. **Identify research needs** that require deeper investigation:
   - Complex technical problems that need detailed solutions
   - Architecture patterns that need exploration
   - Performance optimizations or best practices
   - Security considerations or compliance requirements
   - Integration challenges with external systems

3. **Prepare for final planning** by organizing:
   - Clear understanding of all requirements
   - Identified technical challenges
   - Research questions for deeper investigation

## Output Format

Create a research needs document: `{{outputDir}}/research-needs.md`

Structure your document as follows:
```markdown
# Research Needs: {{objective}}

## Refined Understanding
Brief summary incorporating user's answers and clarifications

## Research Topics

### Topic 1: [Specific Technical Challenge]
**Why this needs research:**
- Explanation of the complexity
- Impact on the implementation

**Key questions to investigate:**
- Specific technical question 1
- Specific technical question 2

**Expected outcomes:**
- What information/decisions we need
- How this will inform the implementation

### Topic 2: [Another Technical Challenge]
[Same structure as above]

## Implementation Considerations
List of decisions or patterns that depend on research outcomes

## Next Steps
What will be possible after research is complete
```

## Important Notes

- Focus on genuinely complex technical challenges
- Don't request research for basic implementation details
- Be specific about what information is needed
- Explain why each topic requires deeper investigation
- Consider performance, security, and maintainability
- Keep research requests focused and actionable
- Ensure the document is well-structured and clear