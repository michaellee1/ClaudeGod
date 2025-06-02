'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SuccessAnimationProps {
  show: boolean
  message?: string
  onComplete?: () => void
  className?: string
}

export function SuccessAnimation({ show, message = 'Success!', onComplete, className }: SuccessAnimationProps) {
  const [isVisible, setIsVisible] = useState(false)

  // Animation timing is an appropriate use of useEffect
  // We're managing a timeout that needs cleanup
  useEffect(() => {
    if (show) {
      setIsVisible(true)
      const timer = setTimeout(() => {
        setIsVisible(false)
        onComplete?.()
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [show, onComplete])

  if (!isVisible) return null

  return (
    <div className={cn(
      "fixed inset-0 z-50 flex items-center justify-center pointer-events-none",
      className
    )}>
      <div className="animate-in zoom-in-95 fade-in duration-300">
        <div className="bg-white rounded-full p-6 shadow-2xl">
          <CheckCircle2 className="w-16 h-16 text-green-500 animate-in zoom-in-105 duration-500" />
        </div>
        <p className="text-center mt-4 text-lg font-medium text-gray-900 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200">
          {message}
        </p>
      </div>
    </div>
  )
}

export function InlineSuccessAnimation({ show, message = 'Complete!', className }: Omit<SuccessAnimationProps, 'onComplete'>) {
  const [isVisible, setIsVisible] = useState(false)

  // Animation timing is an appropriate use of useEffect
  // We're managing a timeout that needs cleanup
  useEffect(() => {
    if (show) {
      setIsVisible(true)
      const timer = setTimeout(() => {
        setIsVisible(false)
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [show])

  if (!isVisible) return null

  return (
    <div className={cn(
      "inline-flex items-center gap-2 text-green-600 animate-in fade-in-50 slide-in-from-left-2 duration-300",
      className
    )}>
      <CheckCircle2 className="w-4 h-4 animate-in zoom-in-105 spin-in-180 duration-500" />
      <span className="text-sm font-medium">{message}</span>
    </div>
  )
}