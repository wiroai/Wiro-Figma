import { useState } from 'preact/hooks';
import type { RecentImage, ScaleMode, SelectionInfo } from '../shared/messages';
import type { Preset } from './actions';
import { SettingField } from './fields';
import { elapsedLabel, shortPricing } from './format';
import { ChevronIcon, LayersIcon, PlusIcon } from './icons';
import { isFileParameter, isPrimary, settingParameters, type SettingOptions } from './models';
import { ModelPicker } from './picker';
import { quote } from './pricing';
import { scaleModeOf, useApp, type ModelSetup, type Runner } from './state';
import type { Size } from '../shared/geometry';

// Parts the tabs share.

/** A link that opens in the browser through Figma (wiro.ai pages and Wiro AI files only). */
export function Link(props: { url: string; children: preact.ComponentChildren }) {
  const app = useApp();
  return (
    <a
      href={props.url}
      onClick={(event) => {
        event.preventDefault();
        app.openUrl(props.url);
      }}
    >
      {props.children}
    </a>
  );
}

/** The chosen model, as a button that opens the model list. */
export function ModelChooser(props: {
  setup: ModelSetup;
  featured: readonly string[];
  disabled?: boolean;
  label?: string;
}) {
  const { setup } = props;
  const [open, setOpen] = useState(false);
  return (
    <>
      <div class="field">
        <span class="field-label">{props.label ?? 'Model'}</span>
        <button type="button" class="model-button" onClick={() => setOpen(true)} disabled={props.disabled}>
          <span class="model-row-main">
            <span class="slug">{setup.slug}</span>
            <span class="title">{setup.summary?.title ?? setup.detail?.title ?? ' '}</span>
          </span>
          {setup.summary && <span class="price">{shortPricing(setup.summary)}</span>}
          <ChevronIcon />
        </button>
      </div>
      {open && (
        <ModelPicker
          models={setup.models}
          featured={props.featured}
          error={setup.modelsError}
          selected={setup.slug}
          onSelect={(slug) => {
            setOpen(false);
            setup.choose(slug);
          }}
          onClose={() => setOpen(false)}
          onRetry={setup.reloadModels}
        />
      )}
    </>
  );
}

/** The model's settings: the main ones in a grid, the rest under More settings. */
export function Settings(props: { setup: ModelSetup; options?: SettingOptions; target?: Size }) {
  const { setup } = props;
  if (setup.detailError) return <div class="notice error">{setup.detailError}</div>;
  if (!setup.detail) return <div class="muted">Loading the model settings…</div>;
  const params = settingParameters(setup.detail, props.options).filter((param) => !isFileParameter(param));
  const primary = params.filter(isPrimary);
  const more = params.filter((param) => !isPrimary(param));
  const field = (param: (typeof params)[number]) => (
    <SettingField
      key={param.id}
      param={param}
      value={setup.values[param.id]}
      target={props.target}
      onChange={(value) => setup.setValue(param.id, value)}
    />
  );
  return (
    <>
      {primary.length > 0 && <div class="grid">{primary.map(field)}</div>}
      {more.length > 0 && (
        <details class="more">
          <summary>More settings</summary>
          <div class="grid">{more.map(field)}</div>
        </details>
      )}
    </>
  );
}

/** A row of choices, such as styles or products. */
export function Chips(props: {
  label: string;
  items: readonly Preset[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div class="field">
      <span class="field-label">{props.label}</span>
      <div class="chips" role="group" aria-label={props.label}>
        {props.items.map((item) => (
          <button
            key={item.id}
            type="button"
            class="chip"
            aria-pressed={item.id === props.value}
            onClick={() => props.onChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A dropdown of choices, for long lists such as languages. */
export function PresetSelect(props: {
  label: string;
  items: readonly Preset[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div class="field">
      <label class="field-label" for="preset-select">
        {props.label}
      </label>
      <select id="preset-select" value={props.value} onChange={(event) => props.onChange(event.currentTarget.value)}>
        {props.items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div class="segmented" role="group" aria-label={props.label}>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === props.value}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function FitToggle() {
  const app = useApp();
  const mode = scaleModeOf(app.preferences);
  return (
    <Segmented<ScaleMode>
      label="Image fit"
      value={mode}
      options={[
        { value: 'FILL', label: 'Fill' },
        { value: 'FIT', label: 'Fit' },
      ]}
      onChange={(scaleMode) => app.updatePreferences((current) => ({ ...current, scaleMode }))}
    />
  );
}

/** Where a new image goes, for actions that fill the selection. */
export function TargetLine(props: { selection: SelectionInfo; extra?: preact.ComponentChildren }) {
  const { selection } = props;
  const count = selection.targets.length;
  let icon = <PlusIcon />;
  let text =
    selection.skipped > 0
      ? 'The selection takes no image fill. A new rectangle will be added.'
      : 'Adds a new rectangle';
  if (count > 0) {
    const first = selection.targets[0]!;
    icon = <LayersIcon />;
    text =
      count === 1
        ? `Fills ${first.name} (${Math.round(first.width)} × ${Math.round(first.height)})`
        : `Fills ${count} selected layers`;
  }
  return (
    <div class="placement">
      <span class="where">
        {icon}
        <span>{text}</span>
      </span>
      {props.extra}
    </div>
  );
}

export function PriceLine(props: {
  setup: ModelSetup;
  params: Record<string, unknown> | undefined;
  outputs: number;
  runs: number;
}) {
  if (!props.setup.detail || !props.params) return null;
  const { line } = quote({
    table: props.setup.priceTable,
    params: props.params,
    outputs: props.outputs,
    runs: props.runs,
    summary: props.setup.summary,
  });
  return <p class="price-line">{line}</p>;
}

/** The run's progress, its result line or its error. */
export function RunStatus(props: { runner: Runner }) {
  const { state } = props.runner;
  if (state.phase === 'idle') return null;
  if (state.phase === 'running' || state.phase === 'finishing') {
    const label =
      state.phase === 'finishing'
        ? state.message
        : state.stopping
          ? 'Stopping'
          : state.total > 1
            ? `${state.status} · ${state.finished} of ${state.total} done`
            : state.status;
    return (
      <div class="status" role="status">
        <span class="spinner" aria-hidden="true" />
        <span>{label}</span>
        <span class="muted">{elapsedLabel(Date.now() - state.startedAt)}</span>
      </div>
    );
  }
  if (state.phase === 'error') {
    return (
      <div class="notice error" role="alert">
        {state.error.message}
        {state.error.link && (
          <>
            {' '}
            <Link url={state.error.link.url}>{state.error.link.label}</Link>
          </>
        )}
        {state.waiting && (
          <div class="notice-actions">
            <button type="button" class="secondary small" onClick={props.runner.keepWaiting}>
              Keep waiting
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div class={state.warning ? 'status done warn' : 'status done'} role="status">
      <span>{state.message}</span>
      {state.warning && <span class="warning">{state.warning}</span>}
    </div>
  );
}

/** The footer: the run button with its short price, or Cancel while a run goes. */
export function RunFooter(props: {
  runner: Runner;
  label: string;
  price?: string;
  disabled: boolean;
  onRun: () => void;
  note?: string;
}) {
  const { state } = props.runner;
  const app = useApp();
  if (state.phase === 'running') {
    return (
      <footer class="actions">
        <button
          type="button"
          class="secondary wide"
          onClick={(event) => props.runner.cancel(event)}
          disabled={!state.canCancel || state.stopping}
        >
          {state.stopping ? 'Stopping…' : state.canCancel ? 'Cancel' : 'Starting…'}
        </button>
      </footer>
    );
  }
  const otherRun = app.busy && state.phase !== 'finishing';
  return (
    <footer class="actions">
      {props.note && <p class="fine center">{props.note}</p>}
      <button
        type="button"
        class="primary wide"
        onClick={props.onRun}
        disabled={props.disabled || state.phase === 'finishing' || otherRun}
        title={otherRun ? 'Another run is going in a different tab.' : undefined}
      >
        <span>{state.phase === 'finishing' ? 'Placing…' : props.label}</span>
        {props.price && state.phase !== 'finishing' && <span class="price">{props.price}</span>}
      </button>
    </footer>
  );
}

/** A grid of images that place themselves when clicked. */
export function Thumbs(props: { images: readonly RecentImage[]; onPick: (image: RecentImage) => void }) {
  return (
    <div class="thumbs">
      {props.images.map((image) => (
        <button
          type="button"
          class={image.kind === 'svg' ? 'thumb vector' : 'thumb'}
          key={image.url}
          title={`${image.prompt}\n${image.model}`}
          onClick={() => props.onPick(image)}
        >
          <img src={image.url} alt={image.prompt} loading="lazy" />
        </button>
      ))}
    </div>
  );
}
