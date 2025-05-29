import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

const settingsPath = path.join(os.homedir(), '.claude-god-merge-settings.json')

interface MergeSettings {
  autoResolveConflicts: boolean
  claudeCodePath?: string
  maxThinkingTime?: number
  model?: string
}

const defaultSettings: MergeSettings = {
  autoResolveConflicts: true,
  maxThinkingTime: 30000,
  model: 'claude-3-5-sonnet-20241022'
}

async function loadSettings(): Promise<MergeSettings> {
  try {
    const data = await fs.readFile(settingsPath, 'utf-8')
    return { ...defaultSettings, ...JSON.parse(data) }
  } catch {
    return defaultSettings
  }
}

async function saveSettings(settings: MergeSettings): Promise<void> {
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2))
}

export async function GET() {
  try {
    const settings = await loadSettings()
    return NextResponse.json(settings)
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to load settings' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const updates = await request.json()
    const currentSettings = await loadSettings()
    const newSettings = { ...currentSettings, ...updates }
    await saveSettings(newSettings)
    
    // Update environment variable for the conflict resolver
    if (newSettings.autoResolveConflicts === false) {
      process.env.CLAUDE_CODE_AUTO_RESOLVE_CONFLICTS = 'false'
    } else {
      delete process.env.CLAUDE_CODE_AUTO_RESOLVE_CONFLICTS
    }
    
    return NextResponse.json(newSettings)
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to save settings' },
      { status: 500 }
    )
  }
}