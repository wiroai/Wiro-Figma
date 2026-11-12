import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Credentials, InitState, PendingRun, Preferences, RecentImage, SelectionInfo } from '../shared/messages';
import { ActionView } from './action-view';
import { actionById, actionsFor, type ActionId, type TabId } from './actions';
import { WIRO_MARK } from './brand';
import { Link, Segmented } from './components';
import { BILLING_URL, describeError, formatUsd, NEW_PROJECT_URL, PROJECTS_URL } from './format';
import { HistoryView } from './history-view';
import { BackIcon, GearIcon } from './icons';
import { AuthError } from './mcp';
import { ModelsView } from './models-view';
import { mergeRecent, recentFrom } from './results';
import { Ctx, useApp, useOption, type AppContext, type Services } from './state';
import type { Account, ModelSummary } from './types';
import { WiroToolError, type ModelWithPricing } from './wiro';

export type { Services } from './state';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'create', label: 'Create' },
  { id: 'edit', label: 'Edit' },
  { id: 'text', label: 'Text' },
  { id: 'models', label: 'Models' },
  { id: 'history', label: 'History' },
];

function maskKey(key: string): string {
  return key.length <= 4 ? '••••' : `••••${key.slice(-4)}`;
}

/** Renders a view once it is first shown, then keeps it (and its state) while hidden. */
function Keep(props: { active: boolean; render: () => preact.JSX.Element }) {
  const [seen, setSeen] = useState(props.active);
  useEffect(() => {
    if (props.active) setSeen(true);
  }, [props.active]);
  if (!seen && !props.active) return null;
  return (
    <div class="keep" hidden={!props.active}>
      {props.render()}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Connect(props: {
  services: Services;
  onConnected: (credentials: Credentials, account: Account) => void;
  openUrl: (url: string) => void;
}) {
  const { services } = props;
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
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

  const onEnter = (event: KeyboardEvent) => {
    if (event.key === 'Enter') void connect();
  };

  return (
    <div class="connect">
      <img class="connect-mark" src={WIRO_MARK} alt="" width="48" height="48" />
      <h1>Connect Wiro AI</h1>
      <p class="muted">
        Paste the API key of a Wiro AI project. Create a project at{' '}
        <a
          href={NEW_PROJECT_URL}
          onClick={(event) => {
            event.preventDefault();
            props.openUrl(NEW_PROJECT_URL);
          }}
        >
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
          onKeyDown={onEnter}
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
          onKeyDown={onEnter}
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
  credentials: Credentials;
  account: Account | null;
  onBack: () => void;
  onDisconnect: () => void;
}) {
  const app = useApp();
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
        <Link url={PROJECTS_URL}>Projects and keys</Link>
        <Link url={BILLING_URL}>Billing</Link>
        <Link url="https://wiro.ai/models">Models</Link>
        <Link url="https://wiro.ai/docs">Docs</Link>
      </div>
      <button type="button" class="secondary" onClick={props.onDisconnect} disabled={app.busy}>
        Disconnect this key
      </button>
      {app.busy && <p class="fine">Wait for the current run to end before you disconnect.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ActionTab(props: { tab: 'create' | 'edit' | 'text'; fallback: ActionId; label: string }) {
  const actions = actionsFor(props.tab);
  const [chosen, setChosen] = useOption(`${props.tab}-action`, props.fallback);
  const current = actions.some((action) => action.id === chosen) ? (chosen as ActionId) : props.fallback;
  const picker =
    actions.length <= 2 ? (
      <Segmented
        label={props.label}
        value={current}
        options={actions.map((action) => ({ value: action.id, label: action.label }))}
        onChange={setChosen}
      />
    ) : (
      <div class="chips action-chips" role="group" aria-label={props.label}>
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            class="chip"
            aria-pressed={action.id === current}
            onClick={() => setChosen(action.id)}
          >
            {action.label}
          </button>
        ))}
      </div>
    );
  return (
    <>
      {actions.map((action) => (
        <Keep
          key={action.id}
          active={action.id === current}
          render={() => <ActionView action={actionById(action.id)} header={picker} />}
        />
      ))}
    </>
  );
}

function Main(props: { account: Account | null; onSettings: () => void }) {
  const app = useApp();
  const tab = (TABS.some((item) => item.id === app.preferences.tab) ? app.preferences.tab : 'create') as TabId;
  const setTab = (next: TabId) => app.updatePreferences((current) => ({ ...current, tab: next }));
  const balance = props.account?.balance?.totalUsd;
  return (
    <div class="main">
      <header class="bar">
        <img class="mark" src={WIRO_MARK} alt="" width="22" height="22" />
        <span class="brand">Wiro AI</span>
        {typeof balance === 'number' && (
          <a
            class="balance"
            href={BILLING_URL}
            title="Wiro AI balance"
            onClick={(event) => {
              event.preventDefault();
              app.openUrl(BILLING_URL);
            }}
          >
            {formatUsd(balance)}
          </a>
        )}
        <button type="button" class="icon-button" aria-label="Settings" onClick={props.onSettings}>
          <GearIcon />
        </button>
      </header>
      <nav class="tabs" role="tablist" aria-label="Sections">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === tab}
            class="tab"
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {app.notice && <div class="banner">{app.notice}</div>}
      <Keep
        active={tab === 'create'}
        render={() => <ActionTab tab="create" fallback="generate" label="What to create" />}
      />
      <Keep
        active={tab === 'edit'}
        render={() => <ActionTab tab="edit" fallback="edit" label="What to do with the image" />}
      />
      <Keep
        active={tab === 'text'}
        render={() => <ActionTab tab="text" fallback="rewrite" label="What to do with the text" />}
      />
      <Keep active={tab === 'models'} render={() => <ModelsView />} />
      <Keep active={tab === 'history'} render={() => <HistoryView active={tab === 'history'} />} />
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
  const [selection, setSelection] = useState<SelectionInfo>({ targets: [], skipped: 0, texts: 0 });
  const [preferences, setPreferences] = useState<Preferences>({});
  const [recent, setRecent] = useState<RecentImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const preferencesRef = useRef(preferences);
  const recentRef = useRef(recent);
  const pendingRef = useRef<PendingRun[]>([]);
  const modelLists = useRef(new Map<string, Promise<ModelSummary[]>>());
  const details = useRef(new Map<string, Promise<ModelWithPricing>>());

  const openUrl = (url: string) => bridge.send({ type: 'open-url', url });
  const notify = (message: string, error?: boolean) => bridge.send({ type: 'notify', message, error });

  function updatePreferences(update: (current: Preferences) => Preferences) {
    preferencesRef.current = update(preferencesRef.current);
    setPreferences(preferencesRef.current);
    bridge.send({ type: 'save-preferences', preferences: preferencesRef.current });
  }

  function addRecent(images: RecentImage[]) {
    recentRef.current = mergeRecent(images, recentRef.current);
    setRecent(recentRef.current);
    bridge.send({ type: 'save-recent', recent: recentRef.current });
  }

  function savePending(next: PendingRun[]) {
    pendingRef.current = next;
    bridge.send({ type: 'save-pending', pending: next });
  }

  const refreshAccount = () => {
    api
      .getAccount()
      .then(setAccount)
      .catch(() => undefined);
  };

  function listModels(categories: readonly string[]): Promise<ModelSummary[]> {
    const key = [...categories].sort().join(',');
    let pending = modelLists.current.get(key);
    if (!pending) {
      pending = (async () => {
        const all: ModelSummary[] = [];
        for (const category of categories) {
          let start = 0;
          for (let page = 0; page < 5; page++) {
            const result = await api.searchModels({
              categories: [category],
              sort: 'ratedusercount',
              start,
              limit: 100,
            });
            all.push(...result.models);
            if (result.nextStart === null || result.models.length === 0) break;
            start = result.nextStart;
          }
        }
        return all;
      })();
      pending.catch(() => modelLists.current.delete(key));
      modelLists.current.set(key, pending);
    }
    return pending;
  }

  function modelDetail(slug: string): Promise<ModelWithPricing> {
    let pending = details.current.get(slug);
    if (!pending) {
      pending = api.getModel(slug);
      pending.catch(() => details.current.delete(slug));
      details.current.set(slug, pending);
    }
    return pending;
  }

  // Runs that were going when the plugin closed: wait for them and keep their results.
  function resume(runs: readonly PendingRun[]) {
    if (runs.length === 0) return;
    setNotice(`Finishing ${runs.length === 1 ? 'a run' : `${runs.length} runs`} from last time…`);
    let found = 0;
    void Promise.all(
      runs.map(async (run) => {
        try {
          const result = await api.waitToEnd(await api.getTask(run.tasktoken));
          const images = recentFrom(result, run.model, run.prompt);
          if (images.length > 0) {
            addRecent(images);
            found += images.length;
          }
          savePending(pendingRef.current.filter((item) => item.tasktoken !== run.tasktoken));
        } catch (error) {
          // A task Wiro no longer knows is dropped; anything else is tried again next time.
          if (error instanceof WiroToolError && /not found/i.test(error.message)) {
            savePending(pendingRef.current.filter((item) => item.tasktoken !== run.tasktoken));
          }
        }
      }),
    ).then(() => setNotice(found > 0 ? `Results from last time are ready in History (${found}).` : undefined));
  }

  function applyInit(state: InitState) {
    setSelection(state.selection);
    preferencesRef.current = state.preferences;
    setPreferences(state.preferences);
    recentRef.current = state.recent;
    setRecent(state.recent);
    pendingRef.current = state.pending;
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
      resume(state.pending);
    }
    setReady(true);
  }

  useEffect(() => {
    const stop = bridge.listen((message) => {
      if (message.type === 'init') applyInit(message);
      if (message.type === 'selection') setSelection(message.selection);
    });
    bridge.send({ type: 'ready' });
    return stop;
  }, []);

  const context: AppContext = useMemo(
    () => ({
      services,
      selection,
      preferences,
      latestPreferences: () => preferencesRef.current,
      updatePreferences,
      recent,
      addRecent,
      addPending: (run) =>
        savePending([run, ...pendingRef.current.filter((item) => item.tasktoken !== run.tasktoken)].slice(0, 10)),
      removePending: (token) => savePending(pendingRef.current.filter((item) => item.tasktoken !== token)),
      refreshAccount,
      onAuthError: () => setView('connect'),
      openUrl,
      notify,
      listModels,
      modelDetail,
      busy,
      setBusy,
      notice,
    }),
    [selection, preferences, recent, busy, notice],
  );

  function disconnect() {
    bridge.send({ type: 'clear-credentials' });
    services.setCredentials(null);
    setCredentialsState(null);
    setAccount(null);
    modelLists.current.clear();
    details.current.clear();
    setView('connect');
  }

  if (!ready) return <div class="loading muted">Loading…</div>;

  return (
    <Ctx.Provider value={context}>
      {view === 'connect' || !credentials ? (
        <Connect
          services={services}
          openUrl={openUrl}
          onConnected={(next, nextAccount) => {
            setCredentialsState(next);
            setAccount(nextAccount);
            setView('main');
          }}
        />
      ) : view === 'settings' ? (
        <SettingsView
          credentials={credentials}
          account={account}
          onBack={() => setView('main')}
          onDisconnect={disconnect}
        />
      ) : (
        <Main account={account} onSettings={() => setView('settings')} />
      )}
    </Ctx.Provider>
  );
}
