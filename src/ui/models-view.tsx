import { useEffect, useMemo, useState } from 'preact/hooks';
import { FitToggle, Link, ModelChooser, PriceLine, RunFooter, RunStatus, Settings, TargetLine } from './components';
import { shortPricing } from './format';
import { inputDataUri } from './images';
import {
  buildParams,
  countParameter,
  defaultFileChoice,
  fileSlots,
  invalidJson,
  missingRequired,
  promptParameter,
  type FileChoice,
  type FileSlot,
} from './models';
import { placeResults } from './place';
import { noResultReason, otherOutputs, readAnswer, recentFrom } from './results';
import { outcomeProblem, useApp, useModelSetup, useOption, useRunner } from './state';
import type { TaskOutput } from './types';

// Run any model of a category, with a form built from its schema. Image
// inputs come from the selected layers or a link; images and vectors go on
// the canvas, text answers can be copied or added as a text layer.

export const CATEGORIES = [
  { id: 'text-to-image', label: 'Text to image' },
  { id: 'image-editing', label: 'Edit with a prompt' },
  { id: 'image-to-image', label: 'Image to image' },
  { id: 'upscale', label: 'Upscale' },
  { id: 'background-removal', label: 'Remove background' },
  { id: 'restoration', label: 'Restore photos' },
  { id: 'image-to-text', label: 'Describe images' },
  { id: 'ocr', label: 'Read text in images' },
  { id: 'translate', label: 'Translate' },
  { id: 'partner-llm', label: 'Chat models' },
] as const;

export function ModelsView() {
  const app = useApp();
  const runner = useRunner();
  const [category, setCategory] = useOption('models-category', 'text-to-image');
  const source = useMemo(
    () => ({ key: `any-${category}`, categories: [category], featured: [], defaultModel: '' }),
    [category],
  );
  const setup = useModelSetup(source, { files: true });
  const [prompt, setPrompt] = useState('');
  const [choices, setChoices] = useState<Record<string, FileChoice>>({});
  const [answer, setAnswer] = useState<string>();
  const [links, setLinks] = useState<TaskOutput[]>([]);

  // A category starts on its first model until one is chosen.
  useEffect(() => {
    if (!setup.slug && setup.models?.[0]) setup.choose(setup.models[0].slug);
  }, [setup.slug, setup.models]);

  // File choices belong to one model; another model starts from its own defaults.
  useEffect(() => setChoices({}), [setup.slug]);

  const { detail } = setup;
  const { selection } = app;
  const layers = selection.targets.length + selection.skipped;
  const slots = detail ? fileSlots(detail) : [];
  const imageSlots = slots.filter((slot) => slot.kind === 'image' || slot.kind === 'file');
  const choiceFor = (slot: FileSlot) =>
    choices[slot.param.id] ?? defaultFileChoice(slot, imageSlots.indexOf(slot), category, selection);
  const promptParam = detail ? promptParameter(detail) : undefined;
  const filled: Record<string, string[]> = {};
  for (const slot of slots) {
    const choice = choiceFor(slot);
    if (choice.from === 'layer' && choice.index < layers) filled[slot.param.id] = ['layer'];
    if (choice.from === 'link' && /^https:\/\//.test(choice.url)) filled[slot.param.id] = [choice.url];
  }
  const missing = detail ? missingRequired(detail, setup.values, { files: filled }) : [];
  const badJson = detail ? invalidJson(detail, setup.values) : [];
  const needsPrompt = !!promptParam?.required && !prompt.trim();
  const target = selection.targets[0];
  const targetSize = target ? { width: target.width, height: target.height } : undefined;
  const preview = detail
    ? buildParams(detail, setup.values, { prompt: prompt || 'prompt', target: targetSize, touched: setup.touched })
    : undefined;
  const countParam = detail ? countParameter(detail) : undefined;
  const outputs = Number(preview?.[countParam?.id ?? ''] ?? 1) || 1;
  const problem = !detail
    ? undefined
    : badJson.length > 0
      ? `${badJson.join(', ')} is not valid JSON.`
      : missing.length > 0
        ? `Fill in ${missing.join(', ')}.`
        : needsPrompt
          ? ''
          : undefined;

  async function useSelectedText() {
    try {
      const items = await app.services.bridge.request({ kind: 'read-text', limit: 50 });
      const text = items
        .map((item) => item.characters.trim())
        .filter(Boolean)
        .join('\n\n');
      if (text) setPrompt(text);
      else app.notify('Select text layers first.', true);
    } catch (error) {
      app.notify(error instanceof Error ? error.message : String(error), true);
    }
  }

  async function run() {
    if (!detail || problem !== undefined || runner.busy || app.busy) return;
    setAnswer(undefined);
    setLinks([]);
    const model = setup.slug;
    try {
      const wanted = Math.max(
        0,
        ...slots.map((slot) => {
          const choice = choiceFor(slot);
          return choice.from === 'layer' ? choice.index + 1 : 0;
        }),
      );
      const exported =
        wanted > 0
          ? await app.services.bridge.request({ kind: 'export', maxSide: 2048, limit: Math.min(wanted, 4) })
          : [];
      const files: Record<string, string[]> = {};
      for (const slot of slots) {
        const choice = choiceFor(slot);
        if (choice.from === 'layer') {
          const image = exported[choice.index];
          if (image) files[slot.param.id] = [await inputDataUri(image)];
        } else if (choice.from === 'link' && /^https:\/\//.test(choice.url)) {
          files[slot.param.id] = [choice.url];
        }
      }
      const params = buildParams(detail, setup.values, { prompt, target: targetSize, touched: setup.touched, files });
      const outcomes = await runner.execute([{ model, params, prompt: prompt || model }]);
      const result = outcomes[0]?.result;
      if (!result || result.state !== 'completed') {
        const found = outcomeProblem(outcomes);
        return runner.fail(
          found?.error ?? new Error(result ? noResultReason(result, 'image') : 'Nothing came back.'),
          found?.waiting,
        );
      }
      const images = recentFrom(result, model, prompt || model);
      const text = images.length === 0 ? await readAnswer(result) : undefined;
      const other = otherOutputs(result);
      if (images.length > 0) {
        runner.setFinishing('Placing');
        app.addRecent(images);
        await placeResults(
          app,
          images,
          { mode: 'fill', targetIds: selection.targets.map((item) => item.id) },
          { name: prompt || model, model, taskId: result.task.id },
        );
      }
      if (text && images.length === 0) setAnswer(text);
      setLinks(other);
      const what =
        images.length > 0
          ? `${images.length} ${images.length === 1 ? 'result' : 'results'}`
          : text
            ? 'text answer below'
            : other.length > 0
              ? `${other.length} ${other.length === 1 ? 'file' : 'files'} below`
              : 'no output';
      runner.finish(outcomes, what);
    } catch (error) {
      runner.fail(error);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      app.notify('Copied');
    } catch {
      // The plugin window may not allow the clipboard API; fall back to a selection copy.
      const area = document.createElement('textarea');
      area.value = text;
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      app.notify(ok ? 'Copied' : 'The text could not be copied.', !ok);
    }
  }

  async function insert(text: string) {
    try {
      await app.services.bridge.request({
        kind: 'insert-text',
        text,
        name: prompt || setup.slug,
        anchorId: selection.targets[0]?.id,
      });
    } catch (error) {
      app.notify(error instanceof Error ? error.message : String(error), true);
    }
  }

  return (
    <div class="tab-body">
      <div class="scroll">
        <p class="hint">Run any model of a category with all of its settings.</p>
        <div class="field">
          <label class="field-label" for="models-category">
            Category
          </label>
          <select id="models-category" value={category} onChange={(event) => setCategory(event.currentTarget.value)}>
            {CATEGORIES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        {setup.slug ? (
          <ModelChooser setup={setup} featured={[]} disabled={runner.busy} />
        ) : setup.modelsError ? (
          <div class="notice error">{setup.modelsError}</div>
        ) : (
          <div class="muted">Loading models…</div>
        )}

        {promptParam && (
          <div class="field">
            <label class="field-label" for="models-prompt">
              {promptParam.label || 'Prompt'}
              <button type="button" class="link small" onClick={() => void useSelectedText()}>
                Use selected text
              </button>
            </label>
            <textarea
              id="models-prompt"
              class="prompt"
              rows={4}
              placeholder={promptParam.placeholder || ''}
              value={prompt}
              onInput={(event) => setPrompt(event.currentTarget.value)}
            />
          </div>
        )}

        {slots.map((slot) => {
          const choice = choiceFor(slot);
          const id = `file-${slot.param.id}`;
          const usesLayers = slot.kind === 'image' || slot.kind === 'file';
          return (
            <div class="field" key={slot.param.id}>
              <label class="field-label" for={id}>
                {slot.param.label || slot.param.id}
                {slot.param.required && <span class="req">required</span>}
              </label>
              <select
                id={id}
                value={choice.from === 'layer' ? `layer-${choice.index}` : choice.from}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  const next: FileChoice =
                    value === 'none'
                      ? { from: 'none' }
                      : value === 'link'
                        ? { from: 'link', url: '' }
                        : { from: 'layer', index: Number(value.slice(6)) };
                  setChoices({ ...choices, [slot.param.id]: next });
                }}
              >
                <option value="none">None</option>
                {usesLayers &&
                  Array.from({ length: Math.min(4, Math.max(1, layers)) }, (_, index) => (
                    <option key={index} value={`layer-${index}`} disabled={index >= layers}>
                      {index === 0 ? 'Selected layer' : `Selected layer ${index + 1}`}
                    </option>
                  ))}
                <option value="link">Link</option>
              </select>
              {choice.from === 'link' && (
                <input
                  type="text"
                  placeholder="https://"
                  value={choice.url}
                  onInput={(event) =>
                    setChoices({ ...choices, [slot.param.id]: { from: 'link', url: event.currentTarget.value } })
                  }
                />
              )}
            </div>
          );
        })}

        <Settings setup={setup} options={{}} target={targetSize} />
        <TargetLine selection={selection} extra={<FitToggle />} />
        {problem && <div class="notice">{problem}</div>}
        <PriceLine setup={setup} params={preview} outputs={outputs} runs={1} />
        <RunStatus runner={runner} />

        {answer && (
          <section class="answer">
            <div class="section-label">Answer</div>
            <pre class="answer-text">{answer}</pre>
            <div class="row">
              <button type="button" class="secondary small" onClick={() => void copy(answer)}>
                Copy
              </button>
              <button type="button" class="secondary small" onClick={() => void insert(answer)}>
                Add as text layer
              </button>
            </div>
          </section>
        )}
        {links.length > 0 && (
          <section class="answer">
            <div class="section-label">Files</div>
            {links.map((output) => (
              <div key={output.url}>
                <Link url={output.url!}>{output.name ?? output.url}</Link>
              </div>
            ))}
          </section>
        )}
      </div>
      <RunFooter
        runner={runner}
        label="Run model"
        price={setup.summary ? shortPricing(setup.summary) : undefined}
        disabled={!detail || problem !== undefined}
        onRun={() => void run()}
      />
    </div>
  );
}
