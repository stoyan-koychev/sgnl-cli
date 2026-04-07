import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { StepState } from '../hooks/useAnalysis';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface LiveProgressProps {
  step: StepState;
  stepNumber: number;
  totalSteps: number;
}

export const LiveProgress: React.FC<LiveProgressProps> = ({ step, stepNumber, totalSteps }) => {
  const [elapsed, setElapsed] = useState(0);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (step.status !== 'running') return;
    const interval = setInterval(() => {
      setElapsed(Date.now() - (step.startedAt ?? Date.now()));
      setFrame(f => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(interval);
  }, [step.status, step.startedAt]);

  return (
    <Box flexDirection="row" paddingLeft={1}>
      <Text color="cyan">{SPINNER_FRAMES[frame]}</Text>
      <Text color="cyan" bold> {step.label}</Text>
      <Text dimColor>  [{stepNumber}/{totalSteps}] {(elapsed / 1000).toFixed(1)}s</Text>
    </Box>
  );
};
