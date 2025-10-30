import React, { Component, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('App Error Boundary caught an error:', error, errorInfo);
  }

  handleReset = () => {
    try {
      localStorage.removeItem('table_columns_person');
      localStorage.removeItem('table_columns_company');
    } catch (e) {
      console.error('Failed to clear preferences:', e);
    }
    window.location.reload();
  };

  handleCopyError = () => {
    if (this.state.error) {
      const errorText = `${this.state.error.name}: ${this.state.error.message}\n\n${this.state.error.stack}`;
      navigator.clipboard.writeText(errorText).then(
        () => alert('Error details copied to clipboard'),
        (err) => console.error('Failed to copy error:', err)
      );
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <div className="max-w-md w-full space-y-6 text-center">
            <div className="flex justify-center">
              <AlertTriangle className="h-16 w-16 text-destructive" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold">Something went wrong</h1>
              <p className="text-muted-foreground">
                The application encountered an unexpected error. Try resetting your preferences to fix the issue.
              </p>
            </div>
            {this.state.error && (
              <div className="bg-muted p-4 rounded-lg text-left">
                <p className="font-mono text-sm text-destructive break-all">
                  {this.state.error.message}
                </p>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Button onClick={this.handleReset} size="lg">
                Reset Preferences & Reload
              </Button>
              {this.state.error && (
                <Button onClick={this.handleCopyError} variant="outline" size="sm">
                  Copy Error Details
                </Button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
