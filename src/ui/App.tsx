import React, { useEffect } from 'react';
import { Box, Text, Static, useApp, useInput } from 'ink';
import { useAnalysis, AnalysisFlags } from './hooks/useAnalysis';
import { LiveProgress } from './components/LiveProgress';
import { StepResult } from './components/StepResult';
import { PipelineProgress } from './components/PipelineProgress';
import { ReportRenderer, SummaryCard } from './report';

interface AppProps {
  url: string;
  flags: AnalysisFlags;
}

export const App: React.FC<AppProps> = ({ url, flags }) => {
  const { exit } = useApp();
  const analysisState = useAnalysis(url, flags);

  useInput((input) => { if (input === 'q') exit(); });

  useEffect(() => {
    if (analysisState.overall === 'done' || analysisState.overall === 'error') {
      setTimeout(() => exit(), 100);
    }
  }, [analysisState.overall]); // eslint-disable-line react-hooks/exhaustive-deps

  const completedSteps = analysisState.steps.filter(
    s => s.status === 'done' || s.status === 'error'
  );
  const activeStep = analysisState.steps.find(s => s.status === 'running');
  const activeStepIndex = analysisState.steps.findIndex(s => s.status === 'running');
  const maxLabel = Math.max(...analysisState.steps.map(s => s.label.length));

  return (
    <Box flexDirection="column">
      <Box paddingBottom={1}>
        <Text bold>SGNL  </Text>
        <Text color="cyan">{url}</Text>
      </Box>

      <Static items={completedSteps}>
        {(step) => <StepResult key={step.id} step={step} labelWidth={maxLabel} />}
      </Static>

      {activeStep && (
        <Box flexDirection="column" marginTop={1}>
          <PipelineProgress steps={analysisState.steps} />
          <LiveProgress
            step={activeStep}
            stepNumber={activeStepIndex + 1}
            totalSteps={analysisState.steps.length}
          />
          <Box marginTop={1}>
            <Text dimColor>[q] quit</Text>
          </Box>
        </Box>
      )}

      {analysisState.finalResult && !analysisState.isPartial && (
        <Box marginTop={1} flexDirection="column">
          {flags.verbose
            ? <ReportRenderer report={analysisState.finalResult} />
            : <SummaryCard report={analysisState.finalResult} />
          }
        </Box>
      )}

      {analysisState.overall === 'error' && (
        <Box marginTop={1}>
          <Text color="red">Analysis failed. Run with --output json for details.</Text>
        </Box>
      )}
    </Box>
  );
};
