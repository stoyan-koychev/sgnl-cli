/**
 * SGNL — Live Progress UI Tests
 * Tests for LiveProgress, StepResult, PipelineProgress components and useAnalysis hook
 */

import React from 'react';
import { render } from 'ink-testing-library';
import { LiveProgress } from '../../src/ui/components/LiveProgress';
import { StepResult } from '../../src/ui/components/StepResult';
import { PipelineProgress } from '../../src/ui/components/PipelineProgress';
import { StepState } from '../../src/ui/hooks/useAnalysis';

jest.mock('../../src/analysis/orchestrator', () => ({
  buildReport: jest.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeStep(overrides: Partial<StepState> = {}): StepState {
  return {
    id: 'fetch',
    label: 'Fetching page',
    status: 'running',
    startedAt: Date.now(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LiveProgress
// ─────────────────────────────────────────────────────────────────────────────

describe('LiveProgress', () => {
  it('renders step label', () => {
    const step = makeStep({ label: 'Fetching page', status: 'running' });
    const { lastFrame } = render(
      <LiveProgress step={step} stepNumber={2} totalSteps={10} />
    );
    expect(lastFrame()).toContain('Fetching page');
  });

  it('renders step counter [2/10]', () => {
    const step = makeStep({ status: 'running' });
    const { lastFrame } = render(
      <LiveProgress step={step} stepNumber={2} totalSteps={10} />
    );
    expect(lastFrame()).toContain('[2/10]');
  });

  it('renders elapsed time in seconds', () => {
    const step = makeStep({ status: 'running', startedAt: Date.now() - 1500 });
    const { lastFrame } = render(
      <LiveProgress step={step} stepNumber={1} totalSteps={10} />
    );
    expect(lastFrame()).toMatch(/\d+\.\d+s/);
  });

  it('renders step counter with correct total', () => {
    const step = makeStep({ status: 'running' });
    const { lastFrame } = render(
      <LiveProgress step={step} stepNumber={5} totalSteps={10} />
    );
    expect(lastFrame()).toContain('[5/10]');
  });

  it('renders without crashing for non-running step', () => {
    const step = makeStep({ status: 'done', startedAt: undefined });
    expect(() => render(
      <LiveProgress step={step} stepNumber={1} totalSteps={10} />
    )).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// StepResult
// ─────────────────────────────────────────────────────────────────────────────

describe('StepResult', () => {
  it('renders checkmark for done step', () => {
    const step = makeStep({ status: 'done', label: 'Fetching page' });
    const { lastFrame } = render(<StepResult step={step} />);
    expect(lastFrame()).toContain('✓');
  });

  it('renders step label for done step', () => {
    const step = makeStep({ status: 'done', label: 'Fetching page' });
    const { lastFrame } = render(<StepResult step={step} />);
    expect(lastFrame()).toContain('Fetching page');
  });

  it('renders cross for error step', () => {
    const step = makeStep({ status: 'error', label: 'Fetching page' });
    const { lastFrame } = render(<StepResult step={step} />);
    expect(lastFrame()).toContain('✗');
  });

  it('renders error message when provided', () => {
    const step = makeStep({ status: 'error', error: 'Connection refused' });
    const { lastFrame } = render(<StepResult step={step} />);
    expect(lastFrame()).toContain('Connection refused');
  });

  it('renders "failed" fallback when no error message', () => {
    const step = makeStep({ status: 'error', error: undefined });
    const { lastFrame } = render(<StepResult step={step} />);
    expect(lastFrame()).toContain('failed');
  });

  it('renders done step without score', () => {
    const step = makeStep({ status: 'done', result: {} });
    const { lastFrame } = render(<StepResult step={step} />);
    expect(lastFrame()).not.toContain('/100');
  });

  it('renders duration when duration_ms is provided', () => {
    const step = makeStep({ status: 'done', duration_ms: 2300 });
    const { lastFrame } = render(<StepResult step={step} />);
    expect(lastFrame()).toContain('2.3s');
  });

  it('does not render duration when duration_ms is absent', () => {
    const step = makeStep({ status: 'done', duration_ms: undefined });
    const { lastFrame } = render(<StepResult step={step} />);
    expect(lastFrame()).not.toContain('(');
  });

  it('renders score >= 90 without crashing (green path)', () => {
    const step = makeStep({ status: 'done', result: { score: 95 } });
    expect(() => render(<StepResult step={step} />)).not.toThrow();
  });

  it('renders score between 70–89 without crashing (yellow path)', () => {
    const step = makeStep({ status: 'done', result: { score: 75 } });
    expect(() => render(<StepResult step={step} />)).not.toThrow();
  });

  it('renders score < 70 without crashing (red path)', () => {
    const step = makeStep({ status: 'done', result: { score: 45 } });
    expect(() => render(<StepResult step={step} />)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PipelineProgress
// ─────────────────────────────────────────────────────────────────────────────

describe('PipelineProgress', () => {
  function makeSteps(statuses: StepState['status'][]): StepState[] {
    return statuses.map((status, i) => ({
      id: `step-${i}`,
      label: `Step ${i}`,
      status,
    }));
  }

  it('shows 0/10 at start', () => {
    const steps = makeSteps(['pending', 'pending', 'pending', 'pending', 'pending',
      'pending', 'pending', 'pending', 'pending', 'pending']);
    const { lastFrame } = render(<PipelineProgress steps={steps} />);
    expect(lastFrame()).toContain('0/10');
  });

  it('shows 5/10 when half done', () => {
    const steps = makeSteps(['done', 'done', 'done', 'done', 'done',
      'pending', 'pending', 'pending', 'pending', 'pending']);
    const { lastFrame } = render(<PipelineProgress steps={steps} />);
    expect(lastFrame()).toContain('5/10');
  });

  it('shows 10/10 when all done', () => {
    const steps = makeSteps(['done', 'done', 'done', 'done', 'done',
      'done', 'done', 'done', 'done', 'done']);
    const { lastFrame } = render(<PipelineProgress steps={steps} />);
    expect(lastFrame()).toContain('10/10');
  });

  it('counts error steps as completed', () => {
    const steps = makeSteps(['done', 'error', 'pending', 'pending', 'pending',
      'pending', 'pending', 'pending', 'pending', 'pending']);
    const { lastFrame } = render(<PipelineProgress steps={steps} />);
    expect(lastFrame()).toContain('2/10');
  });

  it('shows percentage', () => {
    const steps = makeSteps(['done', 'done', 'done', 'done', 'done',
      'pending', 'pending', 'pending', 'pending', 'pending']);
    const { lastFrame } = render(<PipelineProgress steps={steps} />);
    expect(lastFrame()).toContain('50%');
  });

  it('renders block characters for progress bar', () => {
    const steps = makeSteps(['done', 'done', 'done', 'done', 'done',
      'pending', 'pending', 'pending', 'pending', 'pending']);
    const { lastFrame } = render(<PipelineProgress steps={steps} />);
    expect(lastFrame()).toContain('█');
  });

  it('renders empty bar characters for remaining', () => {
    const steps = makeSteps(['done', 'pending', 'pending', 'pending', 'pending',
      'pending', 'pending', 'pending', 'pending', 'pending']);
    const { lastFrame } = render(<PipelineProgress steps={steps} />);
    expect(lastFrame()).toContain('░');
  });
});
