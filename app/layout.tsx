import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Navigation } from '@/components/Navigation'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import '@/lib/utils/global-error-handler'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Claude Task Manager',
  description: 'Manage coding tasks with Claude',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} min-h-screen bg-background text-foreground`}>
        <ErrorBoundary>
          <div className="border-b">
            <div className="flex h-16 items-center px-4">
              <Navigation />
            </div>
          </div>
          {children}
        </ErrorBoundary>
      </body>
    </html>
  )
}