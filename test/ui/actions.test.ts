import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  actionById,
  actionsFor,
  cleanAnswer,
  imagePrompt,
  LANGUAGES,
  PRODUCTS,
  resultName,
  STYLES,
  textPrompt,
  TONES,
} from '../../src/ui/actions';

describe('the action catalog', () => {
  it('gives every action categories, a default model and a tab', () => {
    for (const action of ACTIONS) {
      expect(action.categories.length).toBeGreaterThan(0);
      expect(action.defaultModel).toMatch(/^[^/]+\/.+$/);
      expect(action.featured).toContain(action.defaultModel);
      if (action.only) expect(action.only).toContain(action.defaultModel);
    }
    expect(actionsFor('create').map((action) => action.id)).toEqual(['generate', 'svg']);
    expect(actionsFor('edit').map((action) => action.id)).toEqual([
      'edit',
      'variations',
      'style',
      'upscale',
      'remove-background',
      'mockup',
    ]);
    expect(actionsFor('text').map((action) => action.id)).toEqual(['rewrite', 'shorten', 'translate']);
  });

  it('draws vectors with SVG output and hides the GIF settings', () => {
    expect(actionById('svg').fixed).toEqual({ outputFormat: 'svg', samples: '1' });
    expect(actionById('svg').hide).toEqual(['frameCount', 'frameDurationMs', 'outputCompression']);
  });
});

describe('imagePrompt', () => {
  it('writes the prompt each image action sends', () => {
    expect(imagePrompt(actionById('edit'), ' Make it blue ', undefined, false)).toBe('Make it blue');
    expect(imagePrompt(actionById('variations'), '', undefined, false)).toMatch(
      /^Create a new variation of this image\./,
    );
    expect(imagePrompt(actionById('style'), 'pastel colors', STYLES[0], false)).toBe(
      'Redraw this image as a soft watercolor painting with visible paper texture. Keep the subject and the composition. pastel colors',
    );
    expect(imagePrompt(actionById('style'), '', undefined, true)).toMatch(/style of the second image/);
    expect(imagePrompt(actionById('mockup'), '', PRODUCTS[1], false)).toMatch(/printed on a white ceramic mug/);
  });

  it('names the layers it adds', () => {
    expect(resultName(actionById('variations'), 'Photo', undefined, '')).toBe('Photo variation');
    expect(resultName(actionById('style'), 'Photo', STYLES[2], '')).toBe('Photo, 3D render');
    expect(resultName(actionById('mockup'), 'Logo', PRODUCTS[0], '')).toBe('T-shirt mockup');
    expect(resultName(actionById('remove-background'), 'Photo', undefined, '')).toBe('Photo cutout');
    expect(resultName(actionById('edit'), 'Photo', undefined, 'Make it blue')).toBe('Make it blue');
  });
});

describe('textPrompt and cleanAnswer', () => {
  it('asks for the text only, keeping placeholders, and puts the layer text last', () => {
    const translate = textPrompt(
      actionById('translate'),
      'Hello {name}',
      LANGUAGES.find((item) => item.label === 'Turkish'),
      '',
    );
    expect(translate).toMatch(/^Translate the text below into Turkish\./);
    expect(translate).toMatch(/placeholders such as \{name\}/);
    expect(translate.endsWith('Text:\nHello {name}')).toBe(true);
    expect(textPrompt(actionById('rewrite'), 'Hi', TONES[1], 'for a travel app')).toMatch(
      /Make it warmer and friendlier\. for a travel app/,
    );
    expect(textPrompt(actionById('shorten'), 'Hi', undefined, '')).toMatch(/^Make it about a quarter shorter\./);
  });

  it('removes quotes and code fences around an answer', () => {
    expect(cleanAnswer('  "Plan smarter."  ')).toBe('Plan smarter.');
    expect(cleanAnswer('```\nHello\n```')).toBe('Hello');
    expect(cleanAnswer('He said "hi" to me')).toBe('He said "hi" to me');
  });
});
