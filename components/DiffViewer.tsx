'use client'

import React, { useEffect, useState } from 'react'
import ReactDiffViewer from 'react-diff-viewer-continued'

interface DiffViewerProps {
  diff: string
}

export function DiffViewer({ diff }: DiffViewerProps) {
  const [isDarkMode, setIsDarkMode] = useState(false)
  
  useEffect(() => {
    // Check if dark mode is active
    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains('dark'))
    }
    
    checkDarkMode()
    
    // Watch for theme changes
    const observer = new MutationObserver(checkDarkMode)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    })
    
    return () => observer.disconnect()
  }, [])
  // Parse unified diff format to extract files and their changes
  const parseDiff = (diffString: string) => {
    if (!diffString) {
      return []
    }

    const files: Array<{
      fileName: string
      oldValue: string
      newValue: string
      isNew?: boolean
      isDeleted?: boolean
      isBinary?: boolean
    }> = []

    // Split by file boundaries to handle each file separately
    const fileSections = diffString.split(/(?=^diff --git)/m).filter(Boolean)

    for (const section of fileSections) {
      const lines = section.split('\n')
      let fileName = ''
      let isNew = false
      let isDeleted = false
      let isBinary = false
      const oldLines: string[] = []
      const newLines: string[] = []

      // Extract filename from diff header
      const headerMatch = lines[0].match(/diff --git a\/(.*) b\/(.*)/)
      if (headerMatch) {
        fileName = headerMatch[2]
      }

      let inHunk = false

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i]

        // Check for file status indicators
        if (line.startsWith('new file mode')) {
          isNew = true
        } else if (line.startsWith('deleted file mode')) {
          isDeleted = true
        } else if (line.includes('Binary files') && line.includes('differ')) {
          isBinary = true
          break
        } else if (line.startsWith('@@')) {
          inHunk = true
        } else if (inHunk) {
          // Stop processing hunk when we hit another header
          if (line.startsWith('diff --git') || line.startsWith('index ') || line === '') {
            inHunk = false
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            oldLines.push(line.substring(1))
          } else if (line.startsWith('+') && !line.startsWith('+++')) {
            newLines.push(line.substring(1))
          } else if (line.startsWith(' ')) {
            oldLines.push(line.substring(1))
            newLines.push(line.substring(1))
          }
        }
      }

      if (fileName) {
        files.push({
          fileName,
          oldValue: isNew ? '' : oldLines.join('\n'),
          newValue: isDeleted ? '' : newLines.join('\n'),
          isNew,
          isDeleted,
          isBinary
        })
      }
    }

    return files
  }

  const files = parseDiff(diff)

  if (files.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        No changes found
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {files.map((file, index) => (
        <div key={index} className="border rounded-lg overflow-hidden">
          <div className="bg-muted px-4 py-2 font-mono text-sm flex items-center justify-between">
            <span>{file.fileName}</span>
            {file.isNew && (
              <span className="text-xs bg-green-500/20 text-green-600 dark:text-green-400 px-2 py-1 rounded">New file</span>
            )}
            {file.isDeleted && (
              <span className="text-xs bg-red-500/20 text-red-600 dark:text-red-400 px-2 py-1 rounded">Deleted</span>
            )}
            {file.isBinary && (
              <span className="text-xs bg-gray-500/20 text-gray-600 dark:text-gray-400 px-2 py-1 rounded">Binary</span>
            )}
          </div>
          {file.isBinary ? (
            <div className="p-4 text-center text-muted-foreground">
              Binary file
            </div>
          ) : (
            <ReactDiffViewer
              oldValue={file.oldValue}
              newValue={file.newValue}
              splitView={false}
              showDiffOnly={true}
              useDarkTheme={isDarkMode}
              styles={{
                diffContainer: {
                  fontSize: '13px',
                  fontFamily: 'monospace',
                },
                line: {
                  fontSize: '13px',
                }
              }}
            />
          )}
        </div>
      ))}
    </div>
  )
}