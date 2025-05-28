import { readFile, writeFile, readdir, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { Initiative, InitiativeQuestion } from '../types/initiative'
import { validateInitiative } from './initiative-validation'

// Schema version tracking
const CURRENT_SCHEMA_VERSION = '1.0.0'
const SCHEMA_VERSION_FILE = '.schema_version'

interface MigrationResult {
  success: boolean
  migratedCount: number
  errors: string[]
  warnings: string[]
}

interface SchemaVersion {
  version: string
  migratedAt: Date
}

// Get initiatives base directory
function getInitiativesBaseDir(): string {
  return join(homedir(), '.claude-god-data', 'initiatives')
}

// Read schema version for an initiative
async function getSchemaVersion(initiativeId: string): Promise<string | null> {
  try {
    const versionPath = join(getInitiativesBaseDir(), initiativeId, SCHEMA_VERSION_FILE)
    const content = await readFile(versionPath, 'utf-8')
    const versionData: SchemaVersion = JSON.parse(content)
    return versionData.version
  } catch {
    // No version file means pre-migration format
    return null
  }
}

// Write schema version for an initiative
async function setSchemaVersion(initiativeId: string, version: string): Promise<void> {
  const versionPath = join(getInitiativesBaseDir(), initiativeId, SCHEMA_VERSION_FILE)
  const versionData: SchemaVersion = {
    version,
    migratedAt: new Date()
  }
  await writeFile(versionPath, JSON.stringify(versionData, null, 2), 'utf-8')
}

// Migration from pre-1.0.0 to 1.0.0
async function migrateToV1_0_0(initiativeId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const initiativeDir = join(getInitiativesBaseDir(), initiativeId)
    
    // Check if questions.json exists in old format
    const questionsPath = join(initiativeDir, 'questions.json')
    try {
      const questionsContent = await readFile(questionsPath, 'utf-8')
      const questions = JSON.parse(questionsContent)
      
      // Check if migration is needed (old format has 'question' field instead of 'text')
      if (Array.isArray(questions) && questions.length > 0 && questions[0].question && !questions[0].text) {
        // Migrate questions format
        const migratedQuestions: InitiativeQuestion[] = questions.map((q: any) => ({
          id: q.id,
          question: q.question || q.text, // Support both old and new field names
          category: q.category,
          priority: q.priority || 'medium',
          createdAt: q.createdAt || new Date()
        }))
        
        // Backup original file
        await writeFile(questionsPath + '.backup', questionsContent, 'utf-8')
        
        // Write migrated data
        await writeFile(questionsPath, JSON.stringify(migratedQuestions, null, 2), 'utf-8')
        
        console.log(`[Migration] Migrated questions for initiative ${initiativeId}`)
      }
    } catch (error) {
      // Questions file doesn't exist or is invalid, skip
    }
    
    // Check if initiative.json exists and needs migration
    const initiativePath = join(initiativeDir, 'initiative.json')
    try {
      const initiativeContent = await readFile(initiativePath, 'utf-8')
      const initiative = JSON.parse(initiativeContent)
      
      // Add missing fields with defaults
      const migrated = {
        ...initiative,
        createdAt: initiative.createdAt || new Date(),
        updatedAt: initiative.updatedAt || new Date(),
        completedAt: initiative.completedAt || null,
        error: initiative.error || null
      }
      
      // Validate migrated data
      const validation = validateInitiative(migrated)
      if (!validation.valid) {
        return {
          success: false,
          error: `Validation failed after migration: ${validation.errors[0]?.message}`
        }
      }
      
      // Backup original file
      await writeFile(initiativePath + '.backup', initiativeContent, 'utf-8')
      
      // Write migrated data
      await writeFile(initiativePath, JSON.stringify(migrated, null, 2), 'utf-8')
      
      console.log(`[Migration] Migrated initiative data for ${initiativeId}`)
    } catch (error) {
      // Initiative file doesn't exist, skip
    }
    
    // Set schema version
    await setSchemaVersion(initiativeId, CURRENT_SCHEMA_VERSION)
    
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown migration error'
    }
  }
}

// Check if an initiative needs migration
async function needsMigration(initiativeId: string): Promise<boolean> {
  const version = await getSchemaVersion(initiativeId)
  return version !== CURRENT_SCHEMA_VERSION
}

// Migrate a single initiative
export async function migrateInitiative(initiativeId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const needsMigrationCheck = await needsMigration(initiativeId)
    if (!needsMigrationCheck) {
      return { success: true }
    }
    
    const currentVersion = await getSchemaVersion(initiativeId)
    
    // Apply migrations based on current version
    if (!currentVersion || currentVersion < '1.0.0') {
      const result = await migrateToV1_0_0(initiativeId)
      if (!result.success) {
        return result
      }
    }
    
    // Add future migrations here
    // if (currentVersion < '2.0.0') { await migrateToV2_0_0(initiativeId) }
    
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// Migrate all initiatives
export async function migrateAllInitiatives(): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: true,
    migratedCount: 0,
    errors: [],
    warnings: []
  }
  
  try {
    const baseDir = getInitiativesBaseDir()
    
    // Ensure base directory exists
    await mkdir(baseDir, { recursive: true })
    
    // Get all initiative directories
    const entries = await readdir(baseDir, { withFileTypes: true })
    const initiativeDirs = entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name)
    
    console.log(`[Migration] Found ${initiativeDirs.length} initiatives to check`)
    
    // Migrate each initiative
    for (const initiativeId of initiativeDirs) {
      try {
        const needsMigrationCheck = await needsMigration(initiativeId)
        if (needsMigrationCheck) {
          console.log(`[Migration] Migrating initiative ${initiativeId}...`)
          const migrationResult = await migrateInitiative(initiativeId)
          
          if (migrationResult.success) {
            result.migratedCount++
          } else {
            result.errors.push(`Failed to migrate ${initiativeId}: ${migrationResult.error}`)
            result.success = false
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        result.errors.push(`Error checking ${initiativeId}: ${errorMessage}`)
        result.warnings.push(`Skipped ${initiativeId} due to error`)
      }
    }
    
    console.log(`[Migration] Migration complete. Migrated ${result.migratedCount} initiatives`)
    if (result.errors.length > 0) {
      console.error('[Migration] Errors encountered:', result.errors)
    }
    
    return result
  } catch (error) {
    result.success = false
    result.errors.push(error instanceof Error ? error.message : 'Unknown error during migration')
    return result
  }
}

// Run migrations on startup
export async function runStartupMigrations(): Promise<void> {
  console.log('[Migration] Checking for required migrations...')
  const result = await migrateAllInitiatives()
  
  if (!result.success) {
    console.error('[Migration] Some migrations failed:', result.errors)
    // Don't throw - allow the app to continue with warnings
  } else if (result.migratedCount > 0) {
    console.log(`[Migration] Successfully migrated ${result.migratedCount} initiatives`)
  } else {
    console.log('[Migration] No migrations needed')
  }
}

// Export current schema version for reference
export { CURRENT_SCHEMA_VERSION }