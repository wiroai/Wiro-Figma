import { createContext } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { PendingRun, Preferences, RecentImage, ScaleMode, SelectionInfo } from '../shared/messages';
import type { Action } from './actions';
import type { Bridge } from './bridge';
import { describeError, elapsedLabel, formatUsd, stateLabel, taskCost, type ErrorView } from './format';
import { AuthError } from './mcp';
import { initialValues, isFileParameter, orderModels, settingParameters, type SettingOptions } from './models';
import { parsePriceTable, type PriceTable } from './pricing';
import { recentFrom } from './results';
import type { ModelDetail, ModelSummary, TaskResult } from './types';
import { isAbort, WaitError, WiroApi, WiroToolError, type ModelWithPricing } from './wiro';
import type { Credentials } from '../shared/messages';

// State the tabs share, the model setup each action uses and the runner that
// starts, follows and stops tasks.

export interface Services {
  bridge: Bridge;
  api: WiroApi;
  setCredentials: (credentials: Credentials | null) => void;
}

export interface AppContext {
  services: Services;
  selection: SelectionInfo;
  preferences: Preferences;
  /** The preferences as they are now, for work that finishes after a render. */
  latestPreferences: () => Preferences;
  updatePreferences: (update: (current: Preferences) => Preferences) => void;
  recent: RecentImage[];
  addRecent: (images: RecentImage[]) => void;
  addPending: (run: PendingRun) => void;
  removePending: (token: string) => void;
  refreshAccount: () => void;
  onAuthError: () => void;
  openUrl: (url: string) => void;
  notify: (message: string, error?: boolean) => void;
  /** Model lists, cached per set of categories. */
  listModels: (categories: readonly string[]) => Promise<ModelSummary[]>;
  /** Model schemas with their price text, cached per slug. */
  modelDetail: (slug: string) => Promise<ModelWithPricing>;
  /** True while any tab runs a task. */
  busy: boolean;
  setBusy: (busy: boolean) => void;
  /** A line shown under the tabs, such as runs picked up from last time. */
  notice?: string;
}

export const Ctx = createContext<AppContext | null>(null);

export function useApp(): AppContext {
  const context = useContext(Ctx);
  if (!context) throw new Error('The app context is missing.');
  return context;
}

export function scaleModeOf(preferences: Preferences): ScaleMode {
  return preferences.scaleMode ?? 'FILL';
}

/** A small choice an action keeps, such as its style or language. */
export function useOption(key: string, fallback: string): [string, (value: string) => void] {
  const app = useApp();
  const value = app.preferences.options?.[key] ?? fallback;
  const set = (next: string) =>
    app.updatePreferences((current) => ({ ...current, options: { ...(current.options ?? {}), [key]: next } }));
  return [value, set];
}

// ---------------------------------------------------------------------------
// Model setup

export interface ModelSource {
  /** The key the chosen model is saved under. */
  key: string;
  categories: readonly string[];
  featured: readonly string[];
  defaultModel: string;
  only?: readonly string[];
}

export function sourceOf(action: Action): ModelSource {
  return {
    key: action.id,
    categories: action.categories,
    featured: action.featured,
    defaultModel: action.defaultModel,
    only: action.only,
  };
}

export interface ModelSetup {
  slug: string;
  choose: (slug: string) => void;
  models: ModelSummary[] | null;
  modelsError?: string;
  reloadModels: () => void;
  summary?: ModelSummary;
  detail: ModelDetail | null;
  detailError?: string;
  priceTable?: PriceTable;
  values: Record<string, string>;
  touched: ReadonlySet<string>;
  setValue: (id: string, value: string) => void;
}

/**
 * The model an action uses: its list (from Wiro's categories), the chosen
 * model's schema and price table, and the settings the user changed, which
 * are saved per model and checked against the current schema.
 */
export function useModelSetup(source: ModelSource, options: SettingOptions = {}): ModelSetup {
  const app = useApp();
  const saved = app.preferences.models?.[source.key];
  const slug = saved && (!source.only || source.only.includes(saved)) ? saved : source.defaultModel;
  // The list is kept with the categories it belongs to, so the render right
  // after a category change never shows (or picks from) the old list.
  const [listed, setListed] = useState<{ key: string; models: ModelSummary[] } | null>(null);
  const [modelsError, setModelsError] = useState<{ key: string; message: string }>();
  const [detail, setDetail] = useState<ModelDetail | null>(null);
  const [detailError, setDetailError] = useState<string>();
  const [priceTable, setPriceTable] = useState<PriceTable>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const preferences = useRef(app.preferences);
  preferences.current = app.preferences;
  const hiddenKey = [...(options.hidden ?? [])].sort().join(',');

  const categoryKey = source.categories.join(',');
  const models = listed?.key === categoryKey ? listed.models : null;

  const loadModels = () => {
    const key = categoryKey;
    setModelsError(undefined);
    app
      .listModels(source.categories)
      .then((list) => {
        const ordered = orderModels(list, source.featured);
        setListed({
          key,
          models: source.only ? ordered.filter((model) => source.only!.includes(model.slug)) : ordered,
        });
      })
      .catch((error: unknown) => setModelsError({ key, message: describeError(error).message }));
  };

  useEffect(loadModels, [categoryKey]);

  useEffect(() => {
    let current = true;
    setDetail(null);
    setDetailError(undefined);
    setPriceTable(undefined);
    // No model yet: the Models tab picks the category's first one once the list loads.
    if (!slug) return;
    app
      .modelDetail(slug)
      .then(({ model, text }) => {
        if (!current) return;
        const start = initialValues(model, options);
        const kept: Record<string, string> = {};
        const savedValues = preferences.current.values?.[slug] ?? {};
        for (const param of settingParameters(model, options)) {
          if (isFileParameter(param)) continue;
          const value = savedValues[param.id];
          if (value === undefined) continue;
          // A saved choice that the model no longer offers is dropped.
          if (
            param.options.length > 0 &&
            !param.options.some((option) => option.value === value) &&
            !value.startsWith('__')
          ) {
            continue;
          }
          kept[param.id] = value;
        }
        setDetail(model);
        setPriceTable(parsePriceTable(text));
        setValues({ ...start, ...kept });
        setTouched(new Set(Object.keys(kept)));
      })
      .catch((error: unknown) => {
        if (!current) return;
        if (error instanceof AuthError) app.onAuthError();
        setDetailError(describeError(error).message);
      });
    return () => {
      current = false;
    };
  }, [slug, hiddenKey]);

  const choose = (next: string) => {
    if (next === slug) return;
    app.updatePreferences((current) => ({ ...current, models: { ...(current.models ?? {}), [source.key]: next } }));
  };

  const setValue = (id: string, value: string) => {
    const nextValues = { ...values, [id]: value };
    // Width and height are one choice: changing one keeps both as shown.
    const nextTouched = new Set(touched).add(id);
    if (id === 'width' || id === 'height') {
      nextTouched.add('width');
      nextTouched.add('height');
    }
    setValues(nextValues);
    setTouched(nextTouched);
    const keep: Record<string, string> = {};
    for (const key of nextTouched) if (nextValues[key] !== undefined) keep[key] = nextValues[key]!;
    app.updatePreferences((current) => ({ ...current, values: { ...(current.values ?? {}), [slug]: keep } }));
  };

  const summary = useMemo(() => models?.find((model) => model.slug === slug), [models, slug]);

  return {
    slug,
    choose,
    models,
    modelsError: modelsError?.key === categoryKey ? modelsError.message : undefined,
    reloadModels: loadModels,
    summary,
    detail,
    detailError,
    priceTable,
    values,
    touched,
    setValue,
  };
}

// ---------------------------------------------------------------------------
// Runner

export interface Job {
  model: string;
  params: Record<string, unknown>;
  /** Kept with the run, for Recent and for picking it up later. */
  prompt: string;
}

export interface JobOutcome {
  job: Job;
  result?: TaskResult;
  error?: unknown;
}

export type RunState =
  | { phase: 'idle' }
  | {
      phase: 'running';
      startedAt: number;
      total: number;
      finished: number;
      status: string;
      canCancel: boolean;
      stopping: boolean;
    }
  | { phase: 'finishing'; startedAt: number; message: string }
  | { phase: 'done'; message: string; warning?: string }
  | { phase: 'error'; error: ErrorView; waiting?: { token: string; model: string; prompt: string } };

/** Up to this many tasks run at the same time. */
export const CONCURRENCY = 3;

export interface Runner {
  state: RunState;
  busy: boolean;
  /** Runs the jobs and returns one outcome per job, in order. */
  execute: (jobs: Job[]) => Promise<JobOutcome[]>;
  setFinishing: (message: string) => void;
  /** Ends the run with a done line: what came back, the time it took and its cost. */
  finish: (outcomes: JobOutcome[], what: string, warning?: string) => void;
  fail: (error: unknown, waiting?: { token: string; model: string; prompt: string }) => void;
  cancel: (event?: MouseEvent) => void;
  /** Waits again for a task the panel stopped waiting for; its images go to Recent. */
  keepWaiting: () => void;
  reset: () => void;
}

function isDefinitive(error: unknown): boolean {
  return error instanceof WiroToolError && /not found|could not be found|does not exist/i.test(error.message);
}

/** The total charged for the outcomes, when Wiro said. */
export function totalCost(outcomes: readonly JobOutcome[]): number | undefined {
  let total: number | undefined;
  for (const outcome of outcomes) {
    const cost = outcome.result ? taskCost(outcome.result) : undefined;
    if (cost !== undefined) total = (total ?? 0) + cost;
  }
  return total;
}

/** "2 images · 14 s · $0.13" for the done line. */
export function doneLine(what: string, startedAt: number | undefined, outcomes: readonly JobOutcome[]): string {
  const parts = [what];
  if (startedAt) parts.push(elapsedLabel(Date.now() - startedAt));
  const cost = totalCost(outcomes);
  if (cost !== undefined) parts.push(formatUsd(cost));
  return parts.join(' · ');
}

export function useRunner(): Runner {
  const app = useApp();
  const [state, setState] = useState<RunState>({ phase: 'idle' });
  const controller = useRef<AbortController | null>(null);
  const tokens = useRef(new Map<number, string>());
  const stopped = useRef(new Map<number, Awaited<ReturnType<WiroApi['stop']>>>());
  const startedAt = useRef<number | undefined>(undefined);
  const stateRef = useRef(state);
  stateRef.current = state;

  const busy = state.phase === 'running' || state.phase === 'finishing';
  useEffect(() => app.setBusy(busy), [busy]);

  // A clock for the elapsed time.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => tick((value) => value + 1), 500);
    return () => clearInterval(timer);
  }, [busy]);

  async function execute(jobs: Job[]): Promise<JobOutcome[]> {
    const abort = new AbortController();
    controller.current = abort;
    tokens.current = new Map();
    stopped.current = new Map();
    startedAt.current = Date.now();
    let finished = 0;
    setState({
      phase: 'running',
      startedAt: startedAt.current,
      total: jobs.length,
      finished: 0,
      status: 'Starting',
      canCancel: false,
      stopping: false,
    });
    const outcomes: JobOutcome[] = new Array(jobs.length);
    let next = 0;
    const update = (patch: Partial<Extract<RunState, { phase: 'running' }>>) =>
      setState((current) => (current.phase === 'running' ? { ...current, ...patch } : current));

    const worker = async () => {
      while (next < jobs.length) {
        const index = next++;
        const job = jobs[index]!;
        if (abort.signal.aborted) {
          outcomes[index] = { job, error: new DOMException('Stopped', 'AbortError') };
          continue;
        }
        let token: string | undefined;
        try {
          const result = await app.services.api.runToEnd(job.model, job.params, {
            signal: abort.signal,
            onStarted: (started) => {
              token = started.task.token!;
              tokens.current.set(index, token);
              app.addPending({
                tasktoken: token,
                taskId: started.task.id,
                model: job.model,
                prompt: job.prompt,
                startedAt: Date.now(),
              });
              update({ canCancel: true });
            },
            onUpdate: (result) => update({ status: stateLabel(result) }),
          });
          outcomes[index] = { job, result };
          if (token) app.removePending(token);
        } catch (error) {
          let stop = stopped.current.get(index);
          if (isAbort(error) && token && !stop) {
            // The task started while Cancel was stopping the others: stop it too.
            stop = await app.services.api.stop(token);
          }
          if (isAbort(error) && stop && !stop.stopped && stop.result?.state === 'completed') {
            // The task had already finished when Cancel came: keep its result.
            outcomes[index] = { job, result: stop.result };
            if (token) app.removePending(token);
          } else {
            outcomes[index] = { job, error };
            const confirmedStop = isAbort(error) && stop?.stopped;
            if (token && (confirmedStop || isDefinitive(error))) app.removePending(token);
          }
        }
        finished += 1;
        update({ finished });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
    controller.current = null;
    return outcomes;
  }

  function cancel(event?: MouseEvent) {
    // A double click on Generate must not land on Cancel.
    if (event && event.detail > 1) return;
    const current = stateRef.current;
    if (current.phase !== 'running' || !current.canCancel || current.stopping) return;
    setState({ ...current, stopping: true });
    const pending = [...tokens.current.entries()].map(async ([index, token]) => {
      stopped.current.set(index, await app.services.api.stop(token));
    });
    void Promise.all(pending).then(() => controller.current?.abort());
  }

  function fail(error: unknown, waiting?: { token: string; model: string; prompt: string }) {
    // The full error goes to the plugin console (Plugins > Development > Show console).
    console.error('Wiro AI:', error);
    const view = describeError(error);
    if (view.auth) app.onAuthError();
    setState({ phase: 'error', error: view, waiting });
  }

  function keepWaiting() {
    const current = stateRef.current;
    if (current.phase !== 'error' || !current.waiting) return;
    const { token, model, prompt } = current.waiting;
    startedAt.current = Date.now();
    setState({
      phase: 'running',
      startedAt: startedAt.current,
      total: 1,
      finished: 0,
      status: 'Waiting',
      canCancel: false,
      stopping: false,
    });
    app.services.api
      .waitToEnd({ state: 'running', task: { token }, outputs: [] })
      .then((result) => {
        app.removePending(token);
        const images = recentFrom(result, model, prompt);
        if (images.length > 0) app.addRecent(images);
        setState({
          phase: 'done',
          message:
            images.length > 0
              ? 'The run finished. Its result is in Recent, in the History tab.'
              : 'The run finished without a result.',
        });
      })
      .catch((error: unknown) => fail(error, error instanceof WaitError ? { token, model, prompt } : undefined));
  }

  return {
    state,
    busy,
    execute,
    setFinishing: (message) => setState({ phase: 'finishing', startedAt: startedAt.current ?? Date.now(), message }),
    finish: (outcomes, what, warning) => {
      setState({ phase: 'done', message: `Done: ${doneLine(what, startedAt.current, outcomes)}`, warning });
      if (outcomes.some((outcome) => outcome.result)) app.refreshAccount();
    },
    fail,
    cancel,
    keepWaiting,
    reset: () => setState({ phase: 'idle' }),
  };
}

/**
 * What went wrong across the outcomes, as one message: a confirmed stop, a
 * wait the panel gave up on (with its token), or the first error.
 */
export function outcomeProblem(
  outcomes: readonly JobOutcome[],
): { error: unknown; waiting?: { token: string; model: string; prompt: string } } | undefined {
  const failed = outcomes.filter((outcome) => outcome.error !== undefined);
  if (failed.length === 0) return undefined;
  const waited = failed.find((outcome) => outcome.error instanceof WaitError);
  if (waited) {
    const error = waited.error as WaitError;
    return { error, waiting: { token: error.tasktoken, model: waited.job.model, prompt: waited.job.prompt } };
  }
  const real = failed.find((outcome) => !isAbort(outcome.error)) ?? failed[0]!;
  return { error: real.error };
}
