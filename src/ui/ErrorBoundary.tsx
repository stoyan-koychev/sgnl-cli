import React from 'react';
import { Text } from 'ink';

interface ErrorBoundaryState {
  error?: Error;
}

/**
 * React Error Boundary for the Ink terminal UI.
 * Catches render errors and displays a fallback instead of crashing the CLI.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <Text color="red">
          UI error: {this.state.error.message}. Run with --output json for details.
        </Text>
      );
    }
    return this.props.children;
  }
}
