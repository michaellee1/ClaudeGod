import { NextRequest, NextResponse } from 'next/server'
import { ErrorLogger, ErrorMonitor, handleApiError } from '@/lib/utils/error-handler'
import { toAppError } from '@/lib/utils/errors'

/**
 * POST /api/errors - Log client-side errors
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const logger = ErrorLogger.getInstance()
    const monitor = ErrorMonitor.getInstance()
    
    if (body.errors && Array.isArray(body.errors)) {
      // Batch error logging
      for (const errorData of body.errors) {
        const error = new Error(errorData.error.message || 'Client error')
        Object.assign(error, errorData.error)
        logger.log(error, {
          ...errorData,
          source: 'client',
          userAgent: body.userAgent,
          url: body.url
        })
        
        const appError = toAppError(error)
        monitor.recordError(appError)
      }
    } else if (body.error) {
      // Single error logging
      const error = new Error(body.error.message || 'Client error')
      Object.assign(error, body.error)
      logger.log(error, {
        ...body,
        source: 'client'
      })
      
      const appError = toAppError(error)
      monitor.recordError(appError)
    }
    
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, req)
  }
}

/**
 * GET /api/errors - Get error telemetry (development only)
 */
export async function GET(req: NextRequest) {
  try {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
    }
    
    const logger = ErrorLogger.getInstance()
    const monitor = ErrorMonitor.getInstance()
    
    const searchParams = req.nextUrl.searchParams
    const count = parseInt(searchParams.get('count') || '50')
    
    return NextResponse.json({
      recentErrors: logger.getRecentErrors(count),
      telemetry: monitor.getTelemetry()
    })
  } catch (error) {
    return handleApiError(error, req)
  }
}