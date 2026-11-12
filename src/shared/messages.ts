// Messages between the plugin's main thread (src/code.ts) and its UI iframe
// (src/ui). The main thread owns the document and figma.clientStorage; the UI
// owns the network: it talks to Wiro AI and downloads the finished images.

export type ScaleMode = 'FILL' | 'FIT';

/** The API key of a Wiro AI project, and its secret for signature-based projects. */
export interface Credentials {
  apiKey: string;
  apiSecret?: string;
}

export interface Preferences {
  /** The model slug, `owner/project`. */
  model?: string;
  scaleMode?: ScaleMode;
  /** Settings the user changed, per model slug. */
  values?: Record<string, Record<string, string>>;
}

/** A finished image, kept so it can be placed again without a new run. */
export interface RecentImage {
  url: string;
  model: string;
  prompt: string;
  taskId?: string;
  width?: number;
  height?: number;
  costUsd?: number | null;
  createdAt: number;
}

/** A run that was still going when the plugin last closed. */
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
}

export interface SelectionInfo {
  /** Selected layers that take an image fill, in selection order. */
  targets: SelectionTarget[];
  /** Selected layers that do not, such as groups, lines and slices. */
  skipped: number;
}

/** An image ready for figma.createImage: PNG, JPEG or GIF, at most 4096 px a side. */
export interface ImagePayload {
  bytes: Uint8Array;
  width: number;
  height: number;
  /** Where the image came from, kept on the layer as plugin data. */
  url: string;
}

export interface PlaceRequest {
  requestId: number;
  images: ImagePayload[];
  /** Layers to fill. When empty, each image goes into a new rectangle. */
  targetIds: string[];
  scaleMode: ScaleMode;
  /** The name of new rectangles. */
  name: string;
  model: string;
  taskId?: string;
}

export interface PlaceResult {
  filled: number;
  created: number;
  /** Target layers that were deleted, or can no longer take a fill. */
  missing: number;
}

export type UiToMain =
  | { type: 'ready' }
  | { type: 'save-credentials'; credentials: Credentials }
  | { type: 'clear-credentials' }
  | { type: 'save-preferences'; preferences: Preferences }
  | { type: 'save-recent'; recent: RecentImage[] }
  | { type: 'save-pending'; pending: PendingRun | null }
  | ({ type: 'place' } & PlaceRequest)
  | { type: 'open-url'; url: string }
  | { type: 'notify'; message: string; error?: boolean };

export interface InitState {
  credentials: Credentials | null;
  preferences: Preferences;
  recent: RecentImage[];
  pending: PendingRun | null;
  selection: SelectionInfo;
}

export type MainToUi =
  | ({ type: 'init' } & InitState)
  | { type: 'selection'; selection: SelectionInfo }
  | { type: 'placed'; requestId: number; result?: PlaceResult; error?: string };
