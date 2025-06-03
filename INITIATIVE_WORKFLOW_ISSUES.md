# Initiative Workflow Issues Analysis

## 1. Repository Path Handling Issues

### Problem
The repository path handling in the initiative workflow has several issues:

1. **No validation of repository path**: When creating an initiative, the repository path is not validated to ensure it exists or is accessible.
2. **Confusing parameter usage in ProcessManager**: 
   - ProcessManager constructor takes `(taskId, worktreePath, repoPath)`
   - InitiativeManager passes `(initiativeId, workDir, repositoryPath)` where `workDir` is the initiative data directory
   - The constructor assigns `worktreePath = workDir` (data directory)
   - But then initiative methods override it with `this.worktreePath = initiative.repositoryPath || this.repoPath || process.cwd()`

### Impact
- If a user provides an invalid repository path, the spawn process will fail with ENOENT
- The error message will be generic and not indicate the actual issue
- The working directory confusion could lead to Claude Code running in the wrong directory

### Code Evidence
```typescript
// InitiativeManager.ts line 547
const processManager = new ProcessManager(initiativeId, workDir, initiative.repositoryPath || process.cwd())

// ProcessManager.ts constructor
constructor(taskId?: string, worktreePath?: string, repoPath?: string) {
    this.taskId = taskId || ''
    this.worktreePath = worktreePath || ''  // This gets the data directory
    this.repoPath = repoPath || ''
}

// ProcessManager.ts line 1411 (in runInitiativeExploration)
this.worktreePath = initiative.repositoryPath || this.repoPath || process.cwd()
```

## 2. Error Handling Issues

### Problem
The error handling for initiative processes could be improved:

1. **Generic error messages**: When spawn fails due to invalid working directory, the error message doesn't indicate the actual cause
2. **No pre-validation**: The system doesn't validate the repository path before attempting to spawn Claude Code
3. **Inconsistent error propagation**: Some errors are emitted as events, others are thrown

### Impact
- Users get confusing error messages when repository path is invalid
- Debugging becomes difficult without clear error indicators

## 3. Phase Output File Handling

### Problem
The exploration phase is expected to create an `exploration.md` file, but:

1. The prompt tells Claude Code to save to `{{outputDir}}/exploration.md`
2. The `outputDir` is the initiative data directory, not the repository
3. Claude Code running in the repository directory might not have write access to the data directory

### Code Evidence
```typescript
// initiative-prompts.ts line 51
Save your findings to {{outputDir}}/exploration.md using this standardized structure:

// initiative-manager.ts line 107
prompt = prompt.replace(/{{outputDir}}/g, this.getInitiativeDir(initiative.id))
```

## 4. Missing Features

### Problem
Several important features are missing from the initiative workflow:

1. **No repository path validation** before starting processes
2. **No way to change repository path** after initiative creation
3. **No clear indication** in the UI when repository path is invalid
4. **No recovery mechanism** when processes fail due to bad paths

## 5. State Management Issues

### Problem
The initiative state management has some issues:

1. **Process cleanup on failure**: When exploration fails, the initiative remains in "exploring" state
2. **No retry mechanism**: If a phase fails, there's no way to retry without creating a new initiative
3. **Incomplete error state tracking**: Failed initiatives don't have a clear "failed" status

## Recommendations

1. **Add Repository Path Validation**:
   - Validate repository path exists before creating initiative
   - Add `validateRepositoryPath` function to initiative-validation.ts
   - Check path exists and is a directory
   - Ensure Claude Code has read/write permissions

2. **Fix Parameter Confusion**:
   - Clarify ProcessManager constructor parameters
   - Don't override worktreePath in initiative methods
   - Use consistent naming for repository vs data directories

3. **Improve Error Messages**:
   - Catch ENOENT errors and provide specific message about invalid repository path
   - Add pre-flight checks before spawning processes
   - Include repository path in error messages

4. **Add Recovery Mechanisms**:
   - Allow retrying failed phases
   - Add "retry" button in UI for failed initiatives
   - Allow changing repository path for existing initiatives

5. **Fix Output Directory Issues**:
   - Either run Claude Code with access to data directory
   - Or change prompts to save files within repository and copy them later
   - Ensure consistent file access patterns

6. **Add Initiative Status States**:
   - Add "failed" status to InitiativeStatus enum
   - Track failure reasons
   - Show clear error states in UI