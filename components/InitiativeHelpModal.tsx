'use client'

import React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { HelpCircle, FileText, Lightbulb, AlertCircle } from 'lucide-react'

export function InitiativeHelpModal() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <HelpCircle className="w-4 h-4 mr-2" />
          Help
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Initiative System Help</DialogTitle>
          <DialogDescription>
            Learn how to use the initiative system to plan and execute complex features
          </DialogDescription>
        </DialogHeader>
        
        <Tabs defaultValue="overview" className="mt-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="phases">Phases</TabsTrigger>
            <TabsTrigger value="best-practices">Best Practices</TabsTrigger>
            <TabsTrigger value="troubleshooting">Troubleshooting</TabsTrigger>
          </TabsList>
          
          <TabsContent value="overview" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>What is an Initiative?</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm">
                  An initiative is a structured workflow tool that helps you break down complex objectives 
                  into well-planned, manageable tasks. It guides you through a multi-phase process that 
                  ensures thorough planning before implementation begins.
                </p>
                
                <div className="space-y-2">
                  <h4 className="font-medium text-sm">Key Benefits:</h4>
                  <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                    <li>Systematic approach to feature planning</li>
                    <li>Clear task breakdown with dependencies</li>
                    <li>Research-driven implementation</li>
                    <li>Better project outcomes through planning</li>
                  </ul>
                </div>
                
                <Alert>
                  <Lightbulb className="h-4 w-4" />
                  <AlertDescription>
                    Initiatives work best for features that require multiple tasks or involve uncertainty
                    about implementation approach.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="phases" className="space-y-4 mt-4">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">1. Exploration Phase</CardTitle>
                  <CardDescription>Claude Code explores your codebase</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-2 text-muted-foreground">
                    <li>• Analyzes existing code structure</li>
                    <li>• Creates an initial implementation plan</li>
                    <li>• Generates clarifying questions</li>
                    <li>• Duration: 2-3 minutes</li>
                  </ul>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">2. Questions Phase</CardTitle>
                  <CardDescription>You provide context and requirements</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-2 text-muted-foreground">
                    <li>• Answer generated questions thoughtfully</li>
                    <li>• Provide specific technical requirements</li>
                    <li>• Mention constraints and preferences</li>
                    <li>• Duration: 1-2 minutes</li>
                  </ul>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">3. Research Preparation</CardTitle>
                  <CardDescription>Claude Code identifies research needs</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-2 text-muted-foreground">
                    <li>• Processes your answers</li>
                    <li>• Refines implementation plan</li>
                    <li>• Creates research needs document</li>
                    <li>• Duration: 2-3 minutes</li>
                  </ul>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">4. Research Review</CardTitle>
                  <CardDescription>You provide research findings</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-2 text-muted-foreground">
                    <li>• Use Deep Research or other sources</li>
                    <li>• Paste research results</li>
                    <li>• Include implementation examples</li>
                    <li>• Duration: 1-2 minutes</li>
                  </ul>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">5. Task Generation</CardTitle>
                  <CardDescription>Claude Code creates task breakdown</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-2 text-muted-foreground">
                    <li>• Generates detailed tasks with steps</li>
                    <li>• Identifies dependencies</li>
                    <li>• Sets priorities</li>
                    <li>• Duration: 3-5 minutes</li>
                  </ul>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">6. Ready Phase</CardTitle>
                  <CardDescription>Submit tasks for implementation</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-2 text-muted-foreground">
                    <li>• Review generated tasks</li>
                    <li>• Submit tasks in logical order</li>
                    <li>• Track submission progress</li>
                    <li>• Begin implementation</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
          
          <TabsContent value="best-practices" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Writing Clear Objectives</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-green-600">Do:</p>
                  <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                    <li>Be specific about what you want to achieve</li>
                    <li>Include the scope of the feature</li>
                    <li>Mention any constraints or requirements</li>
                  </ul>
                </div>
                
                <div className="space-y-2">
                  <p className="text-sm font-medium text-red-600">Don't:</p>
                  <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                    <li>Use vague descriptions</li>
                    <li>Include multiple unrelated features</li>
                    <li>Skip important context</li>
                  </ul>
                </div>
                
                <Alert>
                  <FileText className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Good example:</strong> "Add user authentication using JWT tokens with 
                    email/password login and password reset functionality"
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Answering Questions</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm space-y-2">
                  <li>• Provide detailed, thoughtful answers</li>
                  <li>• Include technical specifications</li>
                  <li>• Mention existing patterns in your codebase</li>
                  <li>• Reference any external dependencies</li>
                  <li>• Don't give one-word answers</li>
                </ul>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Conducting Research</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm space-y-2">
                  <li>• Focus on unknowns and uncertainties</li>
                  <li>• Gather implementation examples</li>
                  <li>• Research best practices</li>
                  <li>• Document security considerations</li>
                  <li>• Include performance implications</li>
                </ul>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="troubleshooting" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Common Issues</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <h4 className="font-medium text-sm">Initiative Stuck in Processing</h4>
                  <p className="text-sm text-muted-foreground">
                    If a phase doesn't complete after 10+ minutes:
                  </p>
                  <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                    <li>Refresh the page</li>
                    <li>Check the console for errors</li>
                    <li>Restart the phase if option available</li>
                  </ul>
                </div>
                
                <div className="space-y-2">
                  <h4 className="font-medium text-sm">Claude Code Process Failure</h4>
                  <p className="text-sm text-muted-foreground">
                    If you see process failure errors:
                  </p>
                  <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                    <li>Wait a moment and retry</li>
                    <li>Check if you've hit the 3-process limit</li>
                    <li>Ensure sufficient system resources</li>
                  </ul>
                </div>
                
                <div className="space-y-2">
                  <h4 className="font-medium text-sm">Empty or Invalid Results</h4>
                  <p className="text-sm text-muted-foreground">
                    If phase outputs are empty:
                  </p>
                  <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                    <li>Verify your objective is clear</li>
                    <li>Check previous phase outputs</li>
                    <li>Ensure all required fields are filled</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
            
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Resource Limits:</strong> Maximum 5 concurrent initiatives, maximum 3 Claude Code 
                processes running simultaneously.
              </AlertDescription>
            </Alert>
          </TabsContent>
        </Tabs>
        
        <div className="mt-6 text-center">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => window.open('https://github.com/anthropics/claude-god/blob/main/docs/INITIATIVES.md', '_blank')}
          >
            <FileText className="w-4 h-4 mr-2" />
            View Full Documentation
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}