import { useEffect, useState } from 'react';
import { buildReportStream, ProgressCallback } from '../../analysis/orchestrator';
import { AnalysisReport } from '../../analysis/merger';

export type StepStatus = 'pending' | 'running' | 'done' | 'error';

export interface StepState {
  id: string;
  label: string;
  status: StepStatus;
  result?: Record<string, unknown>;
  error?: string;
  duration_ms?: number;
  startedAt?: number;
}

export interface AnalysisState {
  steps: StepState[];
  overall: 'idle' | 'running' | 'done' | 'error';
  finalResult?: AnalysisReport;
  isPartial?: boolean;
}

export interface AnalysisFlags {
  skipPython?: boolean;
  pythonOnly?: boolean;
  device?: 'mobile' | 'desktop';
  save?: boolean;
  verbose?: boolean;
  splitOptions?: { onlyMainContent?: boolean; includeTags?: string[]; excludeTags?: string[] };
}

const PIPELINE_STEPS = [
  { id: 'validate',  label: 'Validate'  },
  { id: 'fetch',     label: 'Fetch'     },
  { id: 'extract',   label: 'Extract'   },
  { id: 'technical', label: 'Technical' },
  { id: 'xray',      label: 'X-ray'     },
  { id: 'onpage',    label: 'On-page'   },
  { id: 'content',   label: 'Content'   },
  { id: 'report',    label: 'Report'    },
];

// Map orchestrator step IDs → consolidated UI step IDs
const STEP_MAP: Record<string, string> = {
  validate: 'validate',
  fetch: 'fetch',
  psi: 'fetch',
  split: 'extract',
  performance: 'extract',
  technical_seo: 'technical',
  html_xray: 'xray',
  on_page: 'onpage',
  content: 'content',
  score: 'report',
};

export function useAnalysis(url: string, flags: AnalysisFlags): AnalysisState {
  const [state, setState] = useState<AnalysisState>({
    steps: PIPELINE_STEPS.map(s => ({ ...s, status: 'pending' })),
    overall: 'idle',
  });

  useEffect(() => {
    setState(prev => ({ ...prev, overall: 'running' }));

    const onProgress: ProgressCallback = (update) => {
      const mappedId = STEP_MAP[update.id] ?? update.id;
      setState(prev => ({
        ...prev,
        steps: prev.steps.map(s => {
          if (s.id !== mappedId) return s;
          // Don't re-open a completed step
          if (s.status === 'done' && update.status === 'running') return s;
          // Accumulate duration for collapsed steps
          if (s.status === 'done' && update.status === 'done') {
            return { ...s, duration_ms: (s.duration_ms ?? 0) + (update.duration_ms ?? 0) };
          }
          // Accumulate duration if step was already running and is now done
          if (s.status === 'running' && update.status === 'done' && s.duration_ms) {
            return { ...s, ...update, id: mappedId, duration_ms: s.duration_ms + (update.duration_ms ?? 0) };
          }
          return { ...s, ...update, id: mappedId };
        }),
      }));
    };

    (async () => {
      try {
        for await (const report of buildReportStream(url, {
          skipPython: flags.skipPython,
          skipPSI: flags.pythonOnly,
          device: flags.device,
          save: flags.save,
          onProgress,
          splitOptions: flags.splitOptions,
        })) {
          const isPartial = report._partial === true;
          setState(prev => ({
            ...prev,
            finalResult: report,
            isPartial,
            overall: isPartial ? 'running' : 'done',
          }));
        }
      } catch {
        setState(prev => ({ ...prev, overall: 'error' }));
      }
    })();
  }, []);

  return state;
}
