import React from 'react';
import { Box, Text } from 'ink';
import { StepState } from '../hooks/useAnalysis';

export const PipelineProgress: React.FC<{ steps: StepState[] }> = ({ steps }) => {
  const done = steps.filter(s => s.status === 'done' || s.status === 'error').length;
  const total = steps.length;
  const pct = Math.round((done / total) * 100);
  const barWidth = 30;
  const filled = Math.round((done / total) * barWidth);

  return (
    <Box flexDirection="row" paddingLeft={1}>
      <Text dimColor>{'█'.repeat(filled)}{'░'.repeat(barWidth - filled)}</Text>
      <Text dimColor>  {done}/{total} steps ({pct}%)</Text>
    </Box>
  );
};
