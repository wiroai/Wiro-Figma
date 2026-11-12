import { useMemo, useState } from 'preact/hooks';
import type { Size } from '../shared/geometry';
import type { RecentImage, TextItem } from '../shared/messages';
import { cleanAnswer, imagePrompt, resultName, textPrompt, type Action } from './actions';
import {
  Chips,
  FitToggle,
  ModelChooser,
  PresetSelect,
  PriceLine,
  RunFooter,
  RunStatus,
  Segmented,
  Settings,
  TargetLine,
  Thumbs,
} from './components';
import { shortPricing } from './format';
import { inputDataUri } from './images';
import {
  buildParams,
  countParameter,
  invalidJson,
  missingRequired,
  primaryImageSlot,
  promptParameter,
  quickTextOverrides,
  requiredFile,
  type FileSlot,
} from './models';
import { placeResults, type Placement } from './place';
import { noResultReason, readAnswer, recentFrom } from './results';
import {
  outcomeProblem,
  sourceOf,
  useApp,
  useModelSetup,
  useOption,
  useRunner,
  type Job,
  type JobOutcome,
} from './state';
import type { ModelDetail } from './types';

// One action (generate, vector, edit, variations, style, upscale, remove
// background, mockup, rewrite, shorten, translate): its inputs, model,
// settings, price, run and how its results go back on the canvas.

const RUN_LABELS: Record<Action['id'], string> = {
  generate: 'Generate',
  svg: 'Draw vector',
  edit: 'Edit image',
  variations: 'Make variations',
  style: 'Restyle',
  upscale: 'Upscale',
  'remove-background': 'Remove background',
  mockup: 'Make mockup',
  rewrite: 'Rewrite',
  shorten: 'Shorten',
  translate: 'Translate',
};

const COUNTS = ['1', '2', '3', '4'] as const;

interface TextChange {
  name: string;
  before: string;
  after: string;
}

/** Why the action cannot run yet, or undefined when it can. */
function blocker(
  action: Action,
  detail: ModelDetail | null,
  context: {
    prompt: string;
    layers: number;
    texts: number;
    imageSlot?: FileSlot;
    missing: string[];
    badJson: string[];
  },
): string | undefined {
  if (!detail) return undefined;
  if (action.input === 'image') {
    if (!context.imageSlot) return 'This model takes no image. Pick another model.';
    if (context.imageSlot.mode === 'multiple') return 'This model takes image links only. Pick another model.';
    const other = requiredFile(detail, context.imageSlot);
    if (other) return `This model also needs ${other.label || other.id}. Pick another model, or use the Models tab.`;
    if (context.layers === 0) return 'Select a layer to use its image.';
  }
  if (action.input === 'text' && context.texts === 0) return 'Select text layers, or frames that hold text.';
  if (action.prompt === 'required' && promptParameter(detail) && !context.prompt.trim()) return '';
  if (context.badJson.length > 0) return `${context.badJson.join(', ')} is not valid JSON.`;
  if (context.missing.length > 0) return `Fill in ${context.missing.join(', ')}.`;
  return undefined;
}

export function ActionView(props: { action: Action; header?: preact.ComponentChildren }) {
  const { action } = props;
  const app = useApp();
  const runner = useRunner();
  const fixedIds = useMemo(() => new Set([...Object.keys(action.fixed ?? {}), ...(action.hide ?? [])]), [action]);
  const setup = useModelSetup(sourceOf(action), { hidden: fixedIds });
  const [prompt, setPrompt] = useState('');
  const [presetId, setPresetId] = useOption(`${action.id}-preset`, action.presets?.items[0]?.id ?? '');
  const [placementMode, setPlacementMode] = useOption(`${action.id}-placement`, action.placement ?? 'fill');
  const [count, setCount] = useOption(`${action.id}-count`, '1');
  const [perLayer, setPerLayer] = useOption('generate-per-layer', 'false');
  const [textChanges, setTextChanges] = useState<TextChange[]>([]);

  const { selection } = app;
  const { detail } = setup;
  const preset = action.presets?.items.find((item) => item.id === presetId) ?? action.presets?.items[0];
  const targets = selection.targets;
  const layers = targets.length + selection.skipped;
  const first = targets[0];
  const targetSize: Size | undefined = first ? { width: first.width, height: first.height } : undefined;
  const imageSlot = detail && action.input === 'image' ? primaryImageSlot(detail) : undefined;
  const countParam = detail ? countParameter(detail) : undefined;
  const variations = action.id === 'variations' ? Number(count) : 1;
  const fixed: Record<string, string> = {
    ...(action.fixed ?? {}),
    ...(action.input === 'text' && detail ? quickTextOverrides(detail) : {}),
    ...(countParam && variations > 1 ? { [countParam.id]: String(variations) } : {}),
  };
  const fakeFiles = imageSlot ? { [imageSlot.param.id]: ['selected'] } : {};
  const missing = detail ? missingRequired(detail, setup.values, { fixed, files: fakeFiles }) : [];
  const badJson = detail ? invalidJson(detail, setup.values) : [];
  const batch = action.id === 'generate' && perLayer === 'true' && targets.length > 1;
  const jobsFor = action.id === 'variations' && !countParam ? variations : 1;
  const runs = batch ? targets.length : action.input === 'text' ? Math.max(1, selection.texts) : jobsFor;
  const problem = blocker(action, detail, {
    prompt,
    layers,
    texts: selection.texts,
    imageSlot,
    missing,
    badJson,
  });
  const promptForPrice = action.input === 'text' ? 'text' : prompt || 'prompt';
  const previewParams = detail
    ? buildParams(detail, setup.values, {
        prompt: promptForPrice,
        target: action.output === 'svg' ? undefined : targetSize,
        touched: setup.touched,
        fixed,
      })
    : undefined;
  const outputs = Number(previewParams?.[countParam?.id ?? ''] ?? 1) || 1;

  const meta = (model: string, text: string, taskId?: string) => ({ name: text || action.label, model, taskId });

  async function runImages(model: string, modelDetail: ModelDetail) {
    const exported = await app.services.bridge.request({
      kind: 'export',
      maxSide: 2048,
      limit: action.id === 'style' ? 2 : 1,
    });
    const source = exported[0];
    if (!source) throw new Error('Select a layer to use its image.');
    const slot = primaryImageSlot(modelDetail)!;
    const files = [await inputDataUri(source)];
    const reference = action.id === 'style' && slot.mode === 'list' ? exported[1] : undefined;
    if (reference) files.push(await inputDataUri(reference));
    const text = imagePrompt(action, prompt, preset, !!reference);
    const params = buildParams(modelDetail, setup.values, {
      prompt: text,
      target: { width: source.width, height: source.height },
      touched: setup.touched,
      fixed,
      files: { [slot.param.id]: files },
    });
    const jobs: Job[] = Array.from({ length: jobsFor }, () => ({ model, params, prompt: text || action.label }));
    const outcomes = await runner.execute(jobs);
    const results = completed(outcomes);
    if (results.length === 0) return finishProblem(outcomes);
    runner.setFinishing('Placing');
    const images = results.flatMap((result) => recentFrom(result, model, text || action.label));
    if (images.length === 0) return runner.fail(new Error(noResultReason(results[0]!, 'image')));
    app.addRecent(images);
    const sourceFillable = targets.some((target) => target.id === source.id);
    const replace = placementMode === 'replace' && sourceFillable;
    const name = resultName(action, source.name, preset, prompt);
    if (replace) {
      await placeResults(
        app,
        images.slice(0, 1),
        { mode: 'fill', targetIds: [source.id] },
        meta(model, name, results[0]!.task.id),
      );
      if (images.length > 1) {
        await placeResults(
          app,
          images.slice(1),
          { mode: 'beside', targetIds: [], anchorId: source.id },
          meta(model, name),
        );
      }
    } else {
      await placeResults(
        app,
        images,
        { mode: 'beside', targetIds: [], anchorId: source.id },
        meta(model, name, results[0]!.task.id),
      );
    }
    finishWith(outcomes, `${images.length} ${images.length === 1 ? 'image' : 'images'}`);
  }

  async function runGenerate(model: string, modelDetail: ModelDetail) {
    const snapshot = targets.slice(0, 500);
    const text = prompt.trim();
    const jobs: Job[] = batch
      ? snapshot.map((target) => ({
          model,
          params: buildParams(modelDetail, setup.values, {
            prompt: text,
            target: { width: target.width, height: target.height },
            touched: setup.touched,
            fixed,
          }),
          prompt: text,
        }))
      : [
          {
            model,
            params: buildParams(modelDetail, setup.values, {
              prompt: text,
              // Vectors keep the model's own size: SVG output has a minimum pixel area.
              target: action.output === 'svg' ? undefined : targetSize,
              touched: setup.touched,
              fixed,
            }),
            prompt: text,
          },
        ];
    const outcomes = await runner.execute(jobs);
    if (completed(outcomes).length === 0) return finishProblem(outcomes);
    runner.setFinishing('Placing');
    let total = 0;
    let reason: string | undefined;
    for (const [index, outcome] of outcomes.entries()) {
      const result = outcome.result;
      if (!result || result.state !== 'completed') continue;
      const images = recentFrom(result, model, text);
      if (images.length === 0) {
        reason ??= noResultReason(result, action.output === 'svg' ? 'svg' : 'image');
        continue;
      }
      app.addRecent(images);
      const placement: Placement =
        action.output === 'svg'
          ? { mode: 'beside', targetIds: [], anchorId: first?.id }
          : batch
            ? { mode: 'fill', targetIds: [snapshot[index]!.id] }
            : { mode: 'fill', targetIds: snapshot.map((target) => target.id) };
      total += images.length;
      await placeResults(app, images, placement, meta(model, text, result.task.id));
    }
    if (total === 0) return runner.fail(new Error(reason ?? 'The model finished without an image.'));
    const noun = action.output === 'svg' ? (total === 1 ? 'vector' : 'vectors') : total === 1 ? 'image' : 'images';
    finishWith(outcomes, `${total} ${noun}`, reason);
  }

  async function runText(model: string, modelDetail: ModelDetail) {
    const items: TextItem[] = (await app.services.bridge.request({ kind: 'read-text', limit: 200 })).filter((item) =>
      item.characters.trim(),
    );
    if (items.length === 0) throw new Error('The selected text layers are empty.');
    const jobs: Job[] = items.map((item) => ({
      model,
      params: buildParams(modelDetail, setup.values, {
        prompt: textPrompt(action, item.characters, preset, prompt),
        fixed,
      }),
      prompt: item.characters.slice(0, 200),
    }));
    const outcomes = await runner.execute(jobs);
    const answers = await Promise.all(
      outcomes.map(async (outcome) =>
        outcome.result?.state === 'completed' ? cleanAnswer((await readAnswer(outcome.result)) ?? '') : '',
      ),
    );
    const changes = items
      .map((item, index) => ({ item, text: answers[index] ?? '' }))
      .filter((entry) => entry.text && entry.text !== entry.item.characters);
    if (changes.length === 0) return finishProblem(outcomes, 'The model returned no new text.');
    runner.setFinishing('Updating the text');
    const result = await app.services.bridge.request({
      kind: 'set-text',
      items: changes.map((entry) => ({ id: entry.item.id, text: entry.text })),
    });
    setTextChanges(
      changes
        .filter((entry) => !result.failed.some((failure) => failure.id === entry.item.id))
        .map((entry) => ({ name: entry.item.name, before: entry.item.characters, after: entry.text })),
    );
    const warning =
      result.failed.length > 0
        ? `${result.failed.length} not changed: ${result.failed[0]!.name} (${result.failed[0]!.reason})`
        : outcomes.some((outcome) => outcome.error)
          ? `${outcomes.filter((outcome) => outcome.error).length} could not be done.`
          : undefined;
    finishWith(outcomes, `${result.updated} ${result.updated === 1 ? 'text layer' : 'text layers'} updated`, warning);
  }

  function completed(outcomes: readonly JobOutcome[]) {
    return outcomes.map((outcome) => outcome.result).filter((result) => result?.state === 'completed') as NonNullable<
      JobOutcome['result']
    >[];
  }

  function finishProblem(outcomes: readonly JobOutcome[], fallback?: string) {
    const found = outcomeProblem(outcomes);
    if (found) return runner.fail(found.error, found.waiting);
    const result = outcomes.find((outcome) => outcome.result)?.result;
    runner.fail(new Error(result ? noResultReason(result, action.output) : (fallback ?? 'Nothing came back.')));
  }

  function finishWith(outcomes: readonly JobOutcome[], what: string, warning?: string) {
    const failed = outcomes.filter((outcome) => outcome.error).length;
    const note = warning ?? (failed > 0 ? `${failed} of ${outcomes.length} runs did not finish.` : undefined);
    runner.finish([...outcomes], what, note);
  }

  async function run() {
    if (!detail || problem !== undefined || runner.busy || app.busy) return;
    setTextChanges([]);
    const model = setup.slug;
    try {
      if (action.input === 'image') await runImages(model, detail);
      else if (action.input === 'text') await runText(model, detail);
      else await runGenerate(model, detail);
    } catch (error) {
      runner.fail(error);
    }
  }

  const placementChoice =
    action.input === 'image' ? (
      <div class="placement">
        <span class="where muted">Result</span>
        <Segmented
          label="Where the result goes"
          value={placementMode === 'replace' ? 'replace' : 'beside'}
          options={[
            { value: 'replace', label: 'Replace' },
            { value: 'beside', label: 'Beside' },
          ]}
          onChange={setPlacementMode}
        />
      </div>
    ) : null;

  const source = targets[0]?.name ?? (selection.skipped > 0 ? 'the selected layer' : undefined);

  return (
    <div class="tab-body">
      <div class="scroll">
        {props.header}
        <p class="hint">{action.hint}</p>

        {action.input === 'image' && (
          <div class={source ? 'source' : 'source empty'}>
            {source
              ? action.id === 'style' && layers > 1 && imageSlot?.mode === 'list'
                ? `Uses ${source}, in the style of the second selected layer`
                : `Uses ${source}`
              : 'Select a layer to use its image'}
          </div>
        )}
        {action.input === 'text' && (
          <div class={selection.texts > 0 ? 'source' : 'source empty'}>
            {selection.texts > 0
              ? `${selection.texts} ${selection.texts === 1 ? 'text layer' : 'text layers'} selected`
              : 'Select text layers, or frames that hold text'}
          </div>
        )}

        {action.presets && action.presets.items.length > 12 ? (
          <PresetSelect
            label={action.presets.label}
            items={action.presets.items}
            value={preset?.id ?? ''}
            onChange={setPresetId}
          />
        ) : action.presets && !(action.id === 'style' && layers > 1 && imageSlot?.mode === 'list') ? (
          <Chips
            label={action.presets.label}
            items={action.presets.items}
            value={preset?.id ?? ''}
            onChange={setPresetId}
          />
        ) : null}

        {action.prompt !== 'hidden' && (
          <div class="field">
            <label class="field-label" for={`prompt-${action.id}`}>
              {action.promptLabel ?? 'Prompt'}
              {action.prompt === 'optional' && <span class="req">optional</span>}
            </label>
            <textarea
              id={`prompt-${action.id}`}
              class="prompt"
              rows={action.prompt === 'required' ? 4 : 2}
              placeholder={action.promptHint}
              value={prompt}
              onInput={(event) => setPrompt(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void run();
              }}
            />
          </div>
        )}

        {action.id === 'variations' && (
          <div class="placement">
            <span class="where muted">How many</span>
            <Segmented
              label="How many variations"
              value={count}
              options={COUNTS.map((value) => ({ value, label: value }))}
              onChange={setCount}
            />
          </div>
        )}

        <ModelChooser setup={setup} featured={action.featured} disabled={runner.busy} />
        <Settings
          setup={setup}
          options={{ hidden: fixedIds }}
          target={action.output === 'svg' ? undefined : targetSize}
        />

        {action.output === 'image' && action.input === 'none' && (
          <>
            <TargetLine selection={selection} extra={<FitToggle />} />
            {targets.length > 1 && (
              <label class="check">
                <input
                  type="checkbox"
                  checked={perLayer === 'true'}
                  onChange={(event) => setPerLayer(event.currentTarget.checked ? 'true' : 'false')}
                />
                <span>One image per layer, each in its own shape ({targets.length} runs)</span>
              </label>
            )}
          </>
        )}
        {action.output === 'svg' && (
          <p class="fine">The vector goes beside the selected layer, or in the middle of the view.</p>
        )}
        {placementChoice}

        {problem && <div class="notice">{problem}</div>}
        <PriceLine setup={setup} params={previewParams} outputs={outputs} runs={runs} />
        <RunStatus runner={runner} />

        {textChanges.length > 0 && (
          <section class="changes">
            <div class="section-label">Changed</div>
            {textChanges.slice(0, 20).map((change) => (
              <div class="change" key={change.name + change.after}>
                <span class="change-name">{change.name}</span>
                <span class="change-after">{change.after}</span>
              </div>
            ))}
            <p class="fine">Undo in Figma brings the old text back.</p>
          </section>
        )}

        {action.id === 'generate' && app.recent.length > 0 && <RecentStrip />}
      </div>
      <RunFooter
        runner={runner}
        label={RUN_LABELS[action.id]}
        price={setup.summary ? shortPricing(setup.summary) : undefined}
        disabled={!detail || problem !== undefined}
        onRun={() => void run()}
      />
    </div>
  );
}

/** Recent results; a click places one again without a new run. */
export function RecentStrip() {
  const app = useApp();
  async function pick(image: RecentImage) {
    try {
      const targetIds = app.selection.targets.map((target) => target.id);
      await placeResults(
        app,
        [image],
        image.kind === 'svg' ? { mode: 'beside', targetIds: [], anchorId: targetIds[0] } : { mode: 'fill', targetIds },
        { name: image.prompt, model: image.model, taskId: image.taskId },
      );
    } catch (error) {
      app.notify(error instanceof Error ? error.message : String(error), true);
    }
  }
  return (
    <section class="recent">
      <div class="section-label">Recent</div>
      <p class="fine">Click an image to place it again. It costs nothing.</p>
      <Thumbs images={app.recent} onPick={(image) => void pick(image)} />
    </section>
  );
}
