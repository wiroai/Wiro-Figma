import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Bridge } from './bridge';
import { SettingField } from './fields';
import {
  BILLING_URL,
  describeError,
  elapsedLabel,
  formatUsd,
  NEW_PROJECT_URL,
  PROJECTS_URL,
  shortPricing,
  stateLabel,
  taskCost,
  type ErrorView,
} from './format';
import { BackIcon, ChevronIcon, GearIcon, LayersIcon, PlusIcon } from './icons';
import { prepareImage } from './images';
import {
  buildParams,
  DEFAULT_MODEL,
  IMAGE_CATEGORY,
  initialValues,
  isPrimary,
  missingRequired,
  orderModels,
  promptParameter,
  requiredFile,
  settingParameters,
} from './models';
import { ModelPicker } from './picker';
import { mergeRecent, noImageReason, recentFrom } from './results';
import type { Account, ModelDetail, ModelSummary, TaskResult } from './types';
import { WiroApi } from './wiro';
import { AuthError } from './mcp';
import { WIRO_MARK } from './brand';
import type {
  Credentials,
  InitState,
  PendingRun,
  PlaceResult,
  Preferences,
  RecentImage,
  ScaleMode,
  SelectionInfo,
} from '../shared/messages';

export interface Services {
  bridge: Bridge;
  api: WiroApi;
  setCredentials: (credentials: Credentials | null) => void;
}

type Run =
  | { phase: 'idle' }
  | { phase: 'running'; startedAt: number; result?: TaskResult; stopping?: boolean }
  | { phase: 'placing'; startedAt: number; result: TaskResult }
  | { phase: 'done'; result: TaskResult; placed?: PlaceResult; images: RecentImage[]; placeError?: string }
  | { phase: 'error'; error: ErrorView };

function linkTo(bridge: Bridge, url: string) {
  return (event: Event) => {
    event.preventDefault();
    bridge.send({ type: 'open-url', url });
  };
}

function maskKey(key: string): string {
  return key.length <= 4 ? '••••' : `••••${key.slice(-4)}`;
}

function targetSummary(selection: SelectionInfo): { icon: preact.JSX.Element; text: string } {
  const count = selection.targets.length;
  if (count === 0) {
    return {
      icon: <PlusIcon />,
      text:
        selection.skipped > 0
          ? 'The selection takes no image fill. A new rectangle will be added.'
          : 'Adds a new rectangle',
    };
  }
  const first = selection.targets[0]!;
  const size = `${Math.round(first.width)} × ${Math.round(first.height)}`;
  return {
    icon: <LayersIcon />,
    text: count === 1 ? `Fills ${first.name} (${size})` : `Fills ${count} selected layers`,
  };
}

// ---------------------------------------------------------------------------

function Connect(props: {
  services: Services;
  onConnected: (credentials: Credentials, account: Account) => void;
  initial?: Credentials | null;
}) {
  const { services } = props;
  const [apiKey, setApiKey] = useState(props.initial?.apiKey ?? '');
  const [apiSecret, setApiSecret] = useState(props.initial?.apiSecret ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // No <form> submit: Figma's plugin iframe may be sandboxed without
  // allow-forms, which stops form submission before any submit event.
  async function connect() {
    if (busy) return;
    const credentials: Credentials = apiSecret.trim()
      ? { apiKey: apiKey.trim(), apiSecret: apiSecret.trim() }
      : { apiKey: apiKey.trim() };
    if (!credentials.apiKey) return;
    setBusy(true);
    setError(undefined);
    services.setCredentials(credentials);
    try {
      const account = await services.api.getAccount();
      services.bridge.send({ type: 'save-credentials', credentials });
      props.onConnected(credentials, account);
    } catch (caught) {
      services.setCredentials(null);
      setError(describeError(caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="connect">
      <img class="connect-mark" src={WIRO_MARK} alt="" width="48" height="48" />
      <h1>Connect Wiro AI</h1>
      <p class="muted">
        Paste the API key of a Wiro AI project. Create a project at{' '}
        <a href={NEW_PROJECT_URL} onClick={linkTo(services.bridge, NEW_PROJECT_URL)}>
          wiro.ai/panel/project/new
        </a>{' '}
        and copy its key.
      </p>
      <div class="field">
        <label class="field-label" for="api-key">
          API key
        </label>
        <input
          id="api-key"
          type="password"
          autocomplete="off"
          spellcheck={false}
          value={apiKey}
          onInput={(event) => setApiKey(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void connect();
          }}
        />
      </div>
      <div class="field">
        <label class="field-label" for="api-secret">
          API secret <span class="req">signature-based projects only</span>
        </label>
        <input
          id="api-secret"
          type="password"
          autocomplete="off"
          spellcheck={false}
          value={apiSecret}
          onInput={(event) => setApiSecret(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void connect();
          }}
        />
      </div>
      {error && <div class="notice error">{error}</div>}
      <button class="primary" type="button" disabled={busy || !apiKey.trim()} onClick={() => void connect()}>
        {busy ? 'Checking…' : 'Connect'}
      </button>
      <p class="fine">
        The key is saved on this computer in Figma&apos;s storage for this plugin and is sent only to Wiro AI.
      </p>
    </div>
  );
}

function SettingsView(props: {
  services: Services;
  credentials: Credentials;
  account: Account | null;
  onBack: () => void;
  onDisconnect: () => void;
}) {
  const { bridge } = props.services;
  const workspace = props.account?.workspace;
  return (
    <div class="settings">
      <div class="bar">
        <button type="button" class="icon-button" aria-label="Back" onClick={props.onBack}>
          <BackIcon />
        </button>
        <h1>Settings</h1>
      </div>
      <dl class="facts">
        <dt>API key</dt>
        <dd class="mono">{maskKey(props.credentials.apiKey)}</dd>
        <dt>Authentication</dt>
        <dd>{props.credentials.apiSecret ? 'Signature (key and secret)' : 'API key only'}</dd>
        {workspace?.teamName && (
          <>
            <dt>Team</dt>
            <dd>{workspace.teamName}</dd>
          </>
        )}
        {typeof props.account?.balance?.totalUsd === 'number' && (
          <>
            <dt>Balance</dt>
            <dd>{formatUsd(props.account.balance.totalUsd)}</dd>
          </>
        )}
      </dl>
      <div class="links">
        <a href={PROJECTS_URL} onClick={linkTo(bridge, PROJECTS_URL)}>
          Projects and keys
        </a>
        <a href={BILLING_URL} onClick={linkTo(bridge, BILLING_URL)}>
          Billing
        </a>
        <a href="https://wiro.ai/models" onClick={linkTo(bridge, 'https://wiro.ai/models')}>
          Models
        </a>
        <a href="https://wiro.ai/docs" onClick={linkTo(bridge, 'https://wiro.ai/docs')}>
          Docs
        </a>
      </div>
      <button type="button" class="secondary" onClick={props.onDisconnect}>
        Disconnect this key
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function App(props: { services: Services }) {
  const { services } = props;
  const { bridge, api } = services;

  const [ready, setReady] = useState(false);
  const [view, setView] = useState<'connect' | 'main' | 'settings'>('connect');
  const [credentials, setCredentialsState] = useState<Credentials | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [selection, setSelection] = useState<SelectionInfo>({ targets: [], skipped: 0 });
  const [preferences, setPreferences] = useState<Preferences>({});
  const [recent, setRecent] = useState<RecentImage[]>([]);
  const [models, setModels] = useState<ModelSummary[] | null>(null);
  const [modelsError, setModelsError] = useState<string>();
  const [modelSlug, setModelSlug] = useState(DEFAULT_MODEL);
  const [detail, setDetail] = useState<ModelDetail | null>(null);
  const [detailError, setDetailError] = useState<string>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState('');
  const [scaleMode, setScaleMode] = useState<ScaleMode>('FILL');
  const [picking, setPicking] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [run, setRun] = useState<Run>({ phase: 'idle' });
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState<string>();
  const abort = useRef<AbortController | null>(null);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const recentRef = useRef(recent);
  recentRef.current = recent;

  function savePreferences(next: Preferences) {
    setPreferences(next);
    bridge.send({ type: 'save-preferences', preferences: next });
  }

  function addRecent(images: RecentImage[]) {
    const next = mergeRecent(images, recentRef.current);
    setRecent(next);
    bridge.send({ type: 'save-recent', recent: next });
  }

  function refreshAccount() {
    api
      .getAccount()
      .then(setAccount)
      .catch(() => undefined);
  }

  // The main thread answers "ready" with everything it keeps.
  useEffect(() => {
    const stop = bridge.listen((message) => {
      if (message.type === 'init') applyInit(message);
      if (message.type === 'selection') setSelection(message.selection);
    });
    bridge.send({ type: 'ready' });
    return stop;
  }, []);

  function applyInit(state: InitState) {
    setSelection(state.selection);
    setPreferences(state.preferences);
    setRecent(state.recent);
    if (state.preferences.model) setModelSlug(state.preferences.model);
    if (state.preferences.scaleMode) setScaleMode(state.preferences.scaleMode);
    if (state.credentials) {
      services.setCredentials(state.credentials);
      setCredentialsState(state.credentials);
      setView('main');
      api
        .getAccount()
        .then(setAccount)
        .catch((error: unknown) => {
          if (error instanceof AuthError) setView('connect');
        });
      if (state.pending) resume(state.pending);
    }
    setReady(true);
  }

  // A run that was going when the plugin closed: wait for it and keep its images.
  function resume(pending: PendingRun) {
    setNotice('Finishing the run that was going when the plugin closed…');
    api
      .getTask(pending.tasktoken)
      .then((result) => api.waitToEnd(result))
      .then((result) => {
        const images = recentFrom(result, pending.model, pending.prompt);
        if (images.length > 0) {
          addRecent(images);
          setNotice('The image from your last run is ready below. Click it to place it.');
        } else {
          setNotice(undefined);
        }
      })
      .catch(() => setNotice(undefined))
      .finally(() => bridge.send({ type: 'save-pending', pending: null }));
  }

  // The model list loads once the key is in.
  function loadModels() {
    setModelsError(undefined);
    (async () => {
      const all: ModelSummary[] = [];
      let start = 0;
      for (let page = 0; page < 5; page++) {
        const result = await api.searchModels({
          categories: [IMAGE_CATEGORY],
          sort: 'ratedusercount',
          start,
          limit: 100,
        });
        all.push(...result.models);
        if (result.nextStart === null || result.models.length === 0) break;
        start = result.nextStart;
      }
      setModels(orderModels(all));
    })().catch((error: unknown) => setModelsError(describeError(error).message));
  }

  useEffect(() => {
    if (credentials && models === null && !modelsError) loadModels();
  }, [credentials]);

  // The schema of the chosen model.
  useEffect(() => {
    if (!credentials) return;
    let current = true;
    setDetail(null);
    setDetailError(undefined);
    api
      .getModel(modelSlug)
      .then((model) => {
        if (!current) return;
        const saved = preferencesRef.current.values?.[modelSlug] ?? {};
        setDetail(model);
        setValues({ ...initialValues(model), ...saved });
        setTouched(new Set(Object.keys(saved)));
      })
      .catch((error: unknown) => {
        if (current) setDetailError(describeError(error).message);
      });
    return () => {
      current = false;
    };
  }, [modelSlug, credentials]);

  // A clock for the elapsed time while a run is going.
  useEffect(() => {
    if (run.phase !== 'running' && run.phase !== 'placing') return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [run.phase]);

  const target = selection.targets[0];
  const targetSize = target ? { width: target.width, height: target.height } : undefined;
  const settings = useMemo(() => (detail ? settingParameters(detail) : []), [detail]);
  const primary = settings.filter(isPrimary);
  const more = settings.filter((param) => !isPrimary(param));
  const fileNeeded = detail ? requiredFile(detail) : undefined;
  const missing = detail ? missingRequired(detail, values) : [];
  const summary = models?.find((model) => model.slug === modelSlug);
  const busy = run.phase === 'running' || run.phase === 'placing';
  const canRun =
    !!detail && !fileNeeded && missing.length === 0 && !busy && (!promptParameter(detail) || !!prompt.trim());

  function setValue(id: string, value: string) {
    const nextValues = { ...values, [id]: value };
    setValues(nextValues);
    const nextTouched = new Set(touched).add(id);
    setTouched(nextTouched);
    const saved: Record<string, string> = {};
    for (const key of nextTouched) if (nextValues[key] !== undefined) saved[key] = nextValues[key]!;
    savePreferences({
      ...preferencesRef.current,
      values: { ...(preferencesRef.current.values ?? {}), [modelSlug]: saved },
    });
  }

  function chooseModel(slug: string) {
    setPicking(false);
    if (slug === modelSlug) return;
    setModelSlug(slug);
    savePreferences({ ...preferencesRef.current, model: slug });
  }

  function chooseScaleMode(mode: ScaleMode) {
    setScaleMode(mode);
    savePreferences({ ...preferencesRef.current, scaleMode: mode });
  }

  async function place(
    images: RecentImage[],
    targetIds: string[],
    name: string,
    taskId?: string,
  ): Promise<PlaceResult> {
    const payloads = await Promise.all(images.map((image) => prepareImage(image.url)));
    return bridge.place({ images: payloads, targetIds, scaleMode, name, model: images[0]!.model, taskId });
  }

  async function generate() {
    if (!detail || !canRun) return;
    const targets = selection.targets.map((item) => item.id);
    const params = buildParams(detail, values, { prompt, target: targetSize, touched });
    const startedAt = Date.now();
    const controller = new AbortController();
    abort.current = controller;
    const model = detail.slug;
    const text = prompt.trim();
    setRun({ phase: 'running', startedAt });
    try {
      const result = await api.runToEnd(model, params, {
        signal: controller.signal,
        onStarted: (started) => {
          const token = started.task.token;
          if (token) {
            bridge.send({
              type: 'save-pending',
              pending: { tasktoken: token, taskId: started.task.id, model, prompt: text, startedAt },
            });
          }
        },
        onUpdate: (update) =>
          setRun((current) => (current.phase === 'running' ? { ...current, result: update } : current)),
      });
      bridge.send({ type: 'save-pending', pending: null });
      const images = result.state === 'completed' ? recentFrom(result, model, text) : [];
      if (images.length === 0) throw new Error(noImageReason(result));
      addRecent(images);
      setRun({ phase: 'placing', startedAt, result });
      try {
        const placed = await place(images, targets, text, result.task.id);
        setRun({ phase: 'done', result, placed, images });
      } catch (error) {
        setRun({ phase: 'done', result, images, placeError: describeError(error).message });
      }
      refreshAccount();
    } catch (error) {
      if (controller.signal.aborted) {
        bridge.send({ type: 'save-pending', pending: null });
        setRun({ phase: 'error', error: { message: 'Cancelled.' } });
      } else {
        const view = describeError(error);
        setRun({ phase: 'error', error: view });
        if (view.auth) setView('connect');
      }
    } finally {
      abort.current = null;
    }
  }

  function cancel() {
    if (run.phase !== 'running' || !abort.current) return;
    setRun({ ...run, stopping: true });
    abort.current.abort();
  }

  async function placeRecent(image: RecentImage) {
    try {
      await place(
        [image],
        selection.targets.map((item) => item.id),
        image.prompt,
        image.taskId,
      );
    } catch (error) {
      bridge.send({ type: 'notify', message: describeError(error).message, error: true });
    }
  }

  function disconnect() {
    bridge.send({ type: 'clear-credentials' });
    services.setCredentials(null);
    setCredentialsState(null);
    setAccount(null);
    setModels(null);
    setDetail(null);
    setView('connect');
  }

  if (!ready) return <div class="loading muted">Loading…</div>;

  if (view === 'connect' || !credentials) {
    return (
      <Connect
        services={services}
        initial={credentials}
        onConnected={(next, nextAccount) => {
          setCredentialsState(next);
          setAccount(nextAccount);
          setView('main');
        }}
      />
    );
  }

  if (view === 'settings') {
    return (
      <SettingsView
        services={services}
        credentials={credentials}
        account={account}
        onBack={() => setView('main')}
        onDisconnect={disconnect}
      />
    );
  }

  const where = targetSummary(selection);
  const balance = account?.balance?.totalUsd;

  return (
    <div class="main">
      <header class="bar">
        <img class="mark" src={WIRO_MARK} alt="" width="22" height="22" />
        <span class="brand">Wiro AI</span>
        {typeof balance === 'number' && (
          <a class="balance" href={BILLING_URL} title="Wiro AI balance" onClick={linkTo(bridge, BILLING_URL)}>
            {formatUsd(balance)}
          </a>
        )}
        <button type="button" class="icon-button" aria-label="Settings" onClick={() => setView('settings')}>
          <GearIcon />
        </button>
      </header>

      <div class="scroll">
        <button type="button" class="model-button" onClick={() => setPicking(true)} disabled={busy}>
          <span class="model-row-main">
            <span class="slug">{modelSlug}</span>
            <span class="title">{summary?.title ?? detail?.title ?? 'Image model'}</span>
          </span>
          <ChevronIcon />
        </button>

        <div class="field">
          <label class="field-label" for="prompt">
            Prompt
          </label>
          <textarea
            id="prompt"
            rows={4}
            placeholder="Describe the image, for example: a ceramic coffee cup on a linen table, soft morning light"
            value={prompt}
            onInput={(event) => setPrompt(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void generate();
            }}
          />
        </div>

        {detailError && <div class="notice error">{detailError}</div>}
        {!detail && !detailError && <div class="muted">Loading the model settings…</div>}
        {fileNeeded && (
          <div class="notice">
            This model needs an input image ({fileNeeded.label || fileNeeded.id}). Pick a text-to-image model.
          </div>
        )}

        {primary.length > 0 && (
          <div class="grid">
            {primary.map((param) => (
              <SettingField
                key={param.id}
                param={param}
                value={values[param.id]}
                target={targetSize}
                onChange={(value) => setValue(param.id, value)}
              />
            ))}
          </div>
        )}

        {more.length > 0 && (
          <details class="more" open={moreOpen} onToggle={(event) => setMoreOpen(event.currentTarget.open)}>
            <summary>More settings</summary>
            <div class="grid">
              {more.map((param) => (
                <SettingField
                  key={param.id}
                  param={param}
                  value={values[param.id]}
                  target={targetSize}
                  onChange={(value) => setValue(param.id, value)}
                />
              ))}
            </div>
          </details>
        )}

        <div class="placement">
          <span class="where">
            {where.icon}
            <span>{where.text}</span>
          </span>
          <div class="segmented" role="group" aria-label="Image fit">
            <button type="button" aria-pressed={scaleMode === 'FILL'} onClick={() => chooseScaleMode('FILL')}>
              Fill
            </button>
            <button type="button" aria-pressed={scaleMode === 'FIT'} onClick={() => chooseScaleMode('FIT')}>
              Fit
            </button>
          </div>
        </div>

        {notice && <div class="notice">{notice}</div>}
        <RunStatus run={run} now={now} bridge={bridge} />

        {recent.length > 0 && (
          <section class="recent">
            <div class="section-label">Recent</div>
            <p class="fine">Click an image to place it again. It costs nothing.</p>
            <div class="thumbs">
              {recent.map((image) => (
                <button
                  type="button"
                  class="thumb"
                  key={image.url}
                  title={`${image.prompt}\n${image.model}`}
                  onClick={() => void placeRecent(image)}
                >
                  <img src={image.url} alt={image.prompt} loading="lazy" />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      <footer class="actions">
        {run.phase === 'running' ? (
          <button type="button" class="secondary wide" onClick={cancel} disabled={run.stopping}>
            {run.stopping ? 'Stopping…' : 'Cancel'}
          </button>
        ) : (
          <button type="button" class="primary wide" onClick={() => void generate()} disabled={!canRun}>
            <span>{run.phase === 'placing' ? 'Placing…' : 'Generate'}</span>
            {summary && run.phase !== 'placing' && <span class="price">{shortPricing(summary)}</span>}
          </button>
        )}
      </footer>

      {picking && (
        <ModelPicker
          models={models}
          error={modelsError}
          selected={modelSlug}
          onSelect={chooseModel}
          onClose={() => setPicking(false)}
          onRetry={loadModels}
        />
      )}
    </div>
  );
}

function RunStatus(props: { run: Run; now: number; bridge: Bridge }) {
  const { run } = props;
  if (run.phase === 'idle') return null;
  if (run.phase === 'running' || run.phase === 'placing') {
    const label = run.phase === 'placing' ? 'Placing' : run.stopping ? 'Stopping' : stateLabel(run.result);
    return (
      <div class="status" role="status">
        <span class="spinner" aria-hidden="true" />
        <span>{label}</span>
        <span class="muted">{elapsedLabel(props.now - run.startedAt)}</span>
      </div>
    );
  }
  if (run.phase === 'error') {
    return (
      <div class="notice error" role="alert">
        {run.error.message}
        {run.error.link && (
          <>
            {' '}
            <a href={run.error.link.url} onClick={linkTo(props.bridge, run.error.link.url)}>
              {run.error.link.label}
            </a>
          </>
        )}
      </div>
    );
  }
  const cost = taskCost(run.result);
  const seconds = run.result.task.durationSeconds;
  const parts = [`${run.images.length} ${run.images.length === 1 ? 'image' : 'images'}`];
  if (typeof seconds === 'number') parts.push(`${Math.round(seconds)} s`);
  if (cost !== undefined) parts.push(formatUsd(cost));
  return (
    <div class={run.placeError ? 'notice error' : 'status done'} role="status">
      {run.placeError ?? `Done: ${parts.join(' · ')}`}
    </div>
  );
}
