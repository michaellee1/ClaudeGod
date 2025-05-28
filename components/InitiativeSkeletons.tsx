'use client'

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Circle } from 'lucide-react'

export function InitiativeListSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <Card key={i} className="p-6 animate-in fade-in-50 duration-500" style={{ animationDelay: `${i * 100}ms` }}>
          <div className="flex justify-between items-start mb-4">
            <div className="space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
            <Skeleton className="h-6 w-20" />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-4" />
                <Skeleton className="h-4 w-24" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-4" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
            <Skeleton className="h-9 w-20" />
          </div>
        </Card>
      ))}
    </div>
  )
}

export function InitiativeDetailSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-6 w-24" />
      </div>

      <Card className="p-6">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-6 w-20" />
          </div>

          <div className="relative">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="relative" style={{ animationDelay: `${i * 50}ms` }}>
                {i < 6 && (
                  <div className="absolute left-[17px] top-[40px] w-0.5 h-full bg-gray-200" />
                )}
                <div className="relative flex items-start space-x-4 pb-8">
                  <div className="relative z-10 bg-white">
                    <Circle className="w-5 h-5 text-gray-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <Card className="p-4 animate-pulse">
                      <div className="space-y-2">
                        <Skeleton className="h-5 w-32" />
                        <Skeleton className="h-4 w-48" />
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-3 w-3" />
                          <Skeleton className="h-3 w-24" />
                        </div>
                      </div>
                    </Card>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid gap-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  )
}

export function InitiativeTabsSkeleton() {
  return (
    <div className="space-y-4 animate-in fade-in-50 duration-300">
      <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="space-y-4 mt-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  )
}

export function InitiativeValidationSkeleton() {
  return (
    <div className="space-y-4 animate-in fade-in-50 duration-300">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-6 w-20" />
      </div>
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-2" style={{ animationDelay: `${i * 50}ms` }}>
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="h-4 w-64" />
          </div>
        ))}
      </div>
    </div>
  )
}