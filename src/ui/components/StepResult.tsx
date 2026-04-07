import React from 'react';
import { Box, Text } from 'ink';
import { StepState } from '../hooks/useAnalysis';

export const StepResult: React.FC<{ step: StepState; labelWidth?: number }> = ({ step, labelWidth = 12 }) => {
  const timeStr = step.duration_ms !== undefined
    ? `${(step.duration_ms / 1000).toFixed(1)}s`
    : '';

  if (step.status === 'error') {
    return (
      <Box paddingLeft={1}>
        <Text color="red">✗ </Text>
        <Text>{step.label.padEnd(labelWidth)}</Text>
        <Text dimColor>  —     </Text>
        <Text color="red">{step.error ?? 'failed'}</Text>
      </Box>
    );
  }

  return (
    <Box paddingLeft={1}>
      <Text color="green">✓ </Text>
      <Text dimColor>{step.label.padEnd(labelWidth)}</Text>
      <Text dimColor>  {timeStr.padStart(5)}</Text>
    </Box>
  );
};
