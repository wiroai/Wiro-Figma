import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CloseIcon, SearchIcon } from './icons';
import { shortPricing } from './format';
import { searchModels } from './models';
import type { ModelSummary } from './types';

// The model list: featured models first, a search box, owner/slug on top and
// the title small below it.

export function ModelPicker(props: {
  models: ModelSummary[] | null;
  featured: readonly string[];
  error?: string;
  selected: string;
  onSelect: (slug: string) => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const shown = useMemo(() => {
    const models = props.models ?? [];
    const trimmed = query.trim();
    return trimmed ? searchModels(models, trimmed) : models;
  }, [props.models, query]);

  const isFeatured = (slug: string) => props.featured.includes(slug);
  const featured = query.trim() ? [] : shown.filter((model) => isFeatured(model.slug));
  const others = query.trim() ? shown : shown.filter((model) => !isFeatured(model.slug));

  const row = (model: ModelSummary) => (
    <li key={model.slug}>
      <button
        type="button"
        class="model-row"
        aria-pressed={model.slug === props.selected}
        onClick={() => props.onSelect(model.slug)}
      >
        <span class="model-row-main">
          <span class="slug">{model.slug}</span>
          <span class="title">{model.title}</span>
        </span>
        <span class="price">{shortPricing(model)}</span>
      </button>
    </li>
  );

  return (
    <div class="picker" role="dialog" aria-label="Choose a model">
      <div class="picker-head">
        <label class="search">
          <SearchIcon />
          <input
            ref={input}
            type="search"
            placeholder="Search models"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') props.onClose();
            }}
          />
        </label>
        <button type="button" class="icon-button" aria-label="Close" onClick={props.onClose}>
          <CloseIcon />
        </button>
      </div>
      <div class="picker-body">
        {props.error && (
          <div class="notice error">
            {props.error}{' '}
            <button type="button" class="link" onClick={props.onRetry}>
              Try again
            </button>
          </div>
        )}
        {!props.error && props.models === null && <div class="muted pad">Loading models…</div>}
        {featured.length > 0 && (
          <>
            <div class="section-label">Popular</div>
            <ul class="model-list">{featured.map(row)}</ul>
          </>
        )}
        {others.length > 0 && (
          <>
            <div class="section-label">
              {query.trim() ? `${others.length} found` : featured.length > 0 ? 'More models' : 'Models'}
            </div>
            <ul class="model-list">{others.map(row)}</ul>
          </>
        )}
        {props.models !== null && shown.length === 0 && <div class="muted pad">No model matches “{query}”.</div>}
      </div>
    </div>
  );
}
