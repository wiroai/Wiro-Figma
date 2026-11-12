import { isAllowedLink, isPlaceRequest } from './main/guards';
import { layerName, PlacementError, placedMessage, placeImages } from './main/placement';
import { describeSelection } from './main/selection';
import {
  loadState,
  saveCredentials,
  savePending,
  savePreferences,
  saveRecent,
  STORAGE_KEYS,
  type Storage,
} from './main/storage';
import type { MainToUi, PlaceRequest, UiToMain } from './shared/messages';

// The plugin's main thread: it shows the UI, keeps the settings in
// figma.clientStorage, follows the selection and places finished images.
// Everything that touches the network happens in the UI (src/ui).

figma.showUI(__html__, { width: 360, height: 640, themeColors: true });

const storage: Storage = figma.clientStorage;

function post(message: MainToUi): void {
  figma.ui.postMessage(message);
}

function sendSelection(): void {
  post({ type: 'selection', selection: describeSelection(figma.currentPage.selection) });
}

figma.on('selectionchange', sendSelection);
figma.on('currentpagechange', sendSelection);

async function place(message: { type: 'place' } & PlaceRequest): Promise<void> {
  const request: PlaceRequest = { ...message, name: layerName(message.name) };
  try {
    const result = await placeImages(figma, request);
    post({ type: 'placed', requestId: request.requestId, result });
    figma.notify(placedMessage(result));
  } catch (error) {
    const text =
      error instanceof PlacementError
        ? error.message
        : `The image could not be placed: ${error instanceof Error ? error.message : String(error)}`;
    post({ type: 'placed', requestId: request.requestId, error: text });
    figma.notify(text, { error: true });
  }
}

async function handle(message: UiToMain): Promise<void> {
  switch (message.type) {
    case 'ready': {
      const state = await loadState(storage);
      post({ type: 'init', ...state, selection: describeSelection(figma.currentPage.selection) });
      return;
    }
    case 'save-credentials':
      await saveCredentials(storage, message.credentials);
      return;
    case 'clear-credentials':
      await storage.deleteAsync(STORAGE_KEYS.credentials);
      return;
    case 'save-preferences':
      await savePreferences(storage, message.preferences);
      return;
    case 'save-recent':
      await saveRecent(storage, message.recent);
      return;
    case 'save-pending':
      await savePending(storage, message.pending);
      return;
    case 'place':
      if (isPlaceRequest(message)) await place(message);
      return;
    case 'open-url':
      if (isAllowedLink(message.url)) figma.openExternal(message.url);
      return;
    case 'notify':
      if (typeof message.message === 'string' && message.message) {
        figma.notify(message.message.slice(0, 200), { error: message.error === true });
      }
      return;
  }
}

figma.ui.onmessage = (message: UiToMain) => {
  handle(message).catch((error: unknown) => {
    figma.notify(`Wiro AI: ${error instanceof Error ? error.message : String(error)}`, { error: true });
  });
};
