// Messages between the plugin's main thread (src/code.ts) and its UI iframe
// (src/ui). The main thread owns the document and figma.clientStorage; the UI
// owns the network: it talks to Wiro AI and downloads the results.

export type ScaleMode = 'FILL' | 'FIT';

/** The API key of a Wiro AI project, and its secret for signature-based projects. */
export interface Credentials {
  apiKey: string;
  apiSecret?: string;
}

export interface Preferences {
  /** The model chosen for each action, by action id. */
  models?: Record<string, string>;
  scaleMode?: ScaleMode;
  /** Settings the user changed, per model slug. */
  values?: Record<string, Record<string, string>>;
  /** Small choices per action: target language, style, product, placement. */
  options?: Record<string, string>;
  /** The tab that was open last. */
  tab?: string;
}

/** A finished image, kept so it can be placed again without a new run. */
export interface RecentImage {
  url: string;
  /** "svg" for vector results, which go back on the canvas as vector layers. */
  kind?: 'svg';
  model: string;
  prompt: string;
  taskId?: string;
  width?: number;
  height?: number;
  costUsd?: number | null;
  createdAt: number;
}

/** A run that is going, kept until it ends so it can be picked up if the plugin closes. */
export interface PendingRun {
  tasktoken: string;
  taskId?: string;
  model: string;
  prompt: string;
  startedAt: number;
}

/** A selected layer that can take an image fill. */
export interface SelectionTarget {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
  /** The layer shows an image fill, so image actions can read the image itself. */
  hasImage: boolean;
}

export interface SelectionInfo {
  /** Selected layers that take an image fill, in selection order. */
  targets: SelectionTarget[];
  /** Selected layers that do not, such as groups, lines and slices. */
  skipped: number;
  /** Text layers in the selection, counting those inside selected frames. */
  texts: number;
}

/** An image ready for figma.createImage: PNG, JPEG or GIF, at most 4096 px a side. */
export interface ImagePayload {
  bytes: Uint8Array;
  width: number;
  height: number;
  /** Where the image came from, kept on the layer as plugin data. */
  url: string;
}

/** A selected layer as an image, for actions that send it to a model. */
export interface ExportedImage {
  id: string;
  name: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  /** "fill": the layer's own image at full size; "render": the layer drawn as PNG. */
  source: 'fill' | 'render';
}

export interface TextItem {
  id: string;
  name: string;
  characters: string;
}

export interface PlaceResult {
  filled: number;
  created: number;
  /** Target layers that were deleted, or can no longer take a fill. */
  missing: number;
}

export interface SetTextResult {
  updated: number;
  failed: Array<{ id: string; name: string; reason: string }>;
}

/**
 * Requests the UI sends and the main thread answers with a reply:
 * - place: put images into layers ("fill") or in new rectangles; "beside"
 *   puts the new rectangles to the right of the anchor layer.
 * - export: the selected layers as images.
 * - read-text / set-text: the text layers in the selection.
 * - place-svg: an SVG as vector layers.
 * - insert-text: a new text layer.
 */
export type Request =
  | {
      kind: 'place';
      images: ImagePayload[];
      targetIds: string[];
      mode: 'fill' | 'beside';
      anchorId?: string;
      scaleMode: ScaleMode;
      name: string;
      model: string;
      taskId?: string;
    }
  | { kind: 'export'; maxSide: number; limit: number }
  | { kind: 'read-text'; limit: number }
  | { kind: 'set-text'; items: Array<{ id: string; text: string }> }
  | { kind: 'place-svg'; svg: string; name: string; anchorId?: string; model: string; taskId?: string }
  | { kind: 'insert-text'; text: string; name: string; anchorId?: string };

export interface RequestResults {
  place: PlaceResult;
  export: ExportedImage[];
  'read-text': TextItem[];
  'set-text': SetTextResult;
  'place-svg': { created: number };
  'insert-text': { created: number };
}

export type UiToMain =
  | { type: 'ready' }
  | { type: 'save-credentials'; credentials: Credentials }
  | { type: 'clear-credentials' }
  | { type: 'save-preferences'; preferences: Preferences }
  | { type: 'save-recent'; recent: RecentImage[] }
  | { type: 'save-pending'; pending: PendingRun[] }
  | { type: 'request'; requestId: number; request: Request }
  | { type: 'open-url'; url: string }
  | { type: 'notify'; message: string; error?: boolean };

export interface InitState {
  credentials: Credentials | null;
  preferences: Preferences;
  recent: RecentImage[];
  pending: PendingRun[];
  selection: SelectionInfo;
}

export type MainToUi =
  | ({ type: 'init' } & InitState)
  | { type: 'selection'; selection: SelectionInfo }
  | { type: 'reply'; requestId: number; result?: unknown; error?: string };
