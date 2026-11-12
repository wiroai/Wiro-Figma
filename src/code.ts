import { exportSelection, readTexts, setTexts } from './main/export';
import { isAllowedLink, isRequest } from './main/guards';
import { insertText, layerName, PlacementError, placedMessage, placeImages, placeSvg } from './main/placement';
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
import type { MainToUi, Request, UiToMain } from './shared/messages';

// The plugin's main thread: it shows the UI, keeps the settings in
// figma.clientStorage, follows the selection, reads the selected layers for
// the UI and puts results on the canvas. Everything that touches the network
// happens in the UI (src/ui).

figma.showUI(__html__, { width: 380, height: 680, themeColors: true });

const storage: Storage = figma.clientStorage;

function post(message: MainToUi): void {
  figma.ui.postMessage(message);
}

function sendSelection(): void {
  post({ type: 'selection', selection: describeSelection(figma.currentPage.selection) });
}

figma.on('selectionchange', sendSelection);
figma.on('currentpagechange', sendSelection);

async function answer(request: Request): Promise<unknown> {
  switch (request.kind) {
    case 'place': {
      const result = await placeImages(figma, { ...request, name: layerName(request.name) });
      figma.notify(placedMessage(result));
      return result;
    }
    case 'export':
      return exportSelection(figma, figma.currentPage.selection, request.maxSide, request.limit);
    case 'read-text':
      return readTexts(figma.currentPage.selection, request.limit);
    case 'set-text': {
      const result = await setTexts(figma, request.items);
      if (result.updated > 0)
        figma.notify(`Updated ${result.updated} ${result.updated === 1 ? 'text layer' : 'text layers'}`);
      return result;
    }
    case 'place-svg': {
      const result = await placeSvg(figma, { ...request, name: layerName(request.name) });
      figma.notify('Added the vector');
      return result;
    }
    case 'insert-text':
      return insertText(figma, { ...request, name: layerName(request.name) });
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
    case 'request': {
      if (typeof message.requestId !== 'number') return;
      if (!isRequest(message.request)) {
        post({ type: 'reply', requestId: message.requestId, error: 'The plugin sent a request it could not read.' });
        return;
      }
      try {
        post({ type: 'reply', requestId: message.requestId, result: await answer(message.request) });
      } catch (error) {
        const text =
          error instanceof PlacementError
            ? error.message
            : `Figma could not do that: ${error instanceof Error ? error.message : String(error)}`;
        post({ type: 'reply', requestId: message.requestId, error: text });
        figma.notify(text, { error: true });
      }
      return;
    }
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
