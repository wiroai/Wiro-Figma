import { fieldKind, isRatioParameter, MATCH_SELECTION, resolveMatchedRatio } from './models';
import type { ModelParameter } from './types';
import type { Size } from '../shared/geometry';

// One form field for a model setting, built from its Wiro schema.

function optionLabel(label: string, value: string): string {
  const text = (label || value).trim();
  // Option labels can carry long size tables ("1:1 (1K)1024x1024 (2K)..."); keep the start.
  return text.length > 42 ? `${text.slice(0, 41)}…` : text;
}

export function SettingField(props: {
  param: ModelParameter;
  value: string | undefined;
  target?: Size;
  onChange: (value: string) => void;
}) {
  const { param, value, onChange } = props;
  const kind = fieldKind(param);
  const id = `setting-${param.id}`;
  const label = param.label || param.id;
  const help = param.note || param.description;
  let control;

  if (kind === 'choice') {
    const ratio = isRatioParameter(param);
    const matched = ratio ? resolveMatchedRatio(param, props.target) : undefined;
    control = (
      <select id={id} value={value ?? ''} onChange={(event) => onChange(event.currentTarget.value)}>
        {ratio && (
          <option value={MATCH_SELECTION}>
            {props.target ? `Match selection (${matched})` : `Default (${matched})`}
          </option>
        )}
        {value === undefined && !ratio && <option value="">Default</option>}
        {param.options
          .filter((option) => !(ratio && option.value === ''))
          .map((option) => (
            <option key={option.value} value={option.value}>
              {optionLabel(option.label, option.value)}
            </option>
          ))}
      </select>
    );
  } else if (kind === 'boolean') {
    control = (
      <label class="switch">
        <input
          id={id}
          type="checkbox"
          checked={value === 'true'}
          onChange={(event) => onChange(event.currentTarget.checked ? 'true' : 'false')}
        />
        <span>{value === 'true' ? 'On' : 'Off'}</span>
      </label>
    );
  } else if (kind === 'number') {
    control = (
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={value ?? ''}
        min={param.min}
        max={param.max}
        step={param.step ?? (param.type.toLowerCase() === 'float' ? 0.1 : 1)}
        placeholder={param.default ?? ''}
        onInput={(event) => onChange(event.currentTarget.value)}
      />
    );
  } else if (kind === 'textarea') {
    control = (
      <textarea
        id={id}
        rows={2}
        value={value ?? ''}
        placeholder={param.placeholder ?? ''}
        onInput={(event) => onChange(event.currentTarget.value)}
      />
    );
  } else {
    control = (
      <input
        id={id}
        type="text"
        value={value ?? ''}
        placeholder={param.placeholder ?? ''}
        onInput={(event) => onChange(event.currentTarget.value)}
      />
    );
  }

  return (
    <div class="field">
      <label class="field-label" for={id} title={help}>
        {label}
        {param.required && <span class="req">required</span>}
      </label>
      {control}
    </div>
  );
}
