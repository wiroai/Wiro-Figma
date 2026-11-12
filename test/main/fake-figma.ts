// A small stand-in for the Figma plugin API: just enough of the scene graph,
// images, storage and UI channel for the main thread's tests.

export interface FakeNode {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  removed: boolean;
  fills?: unknown;
  pluginData: Record<string, string>;
  resize(width: number, height: number): void;
  setPluginData(key: string, value: string): void;
  getPluginData(key: string): string;
}

let counter = 0;

export function fakeNode(type: string, props: Partial<FakeNode> & { noFills?: boolean } = {}): FakeNode {
  counter += 1;
  const node: FakeNode = {
    id: props.id ?? `${counter}:1`,
    type,
    name: props.name ?? `${type} ${counter}`,
    x: props.x ?? 0,
    y: props.y ?? 0,
    width: props.width ?? 100,
    height: props.height ?? 100,
    removed: props.removed ?? false,
    pluginData: {},
    resize(width, height) {
      this.width = width;
      this.height = height;
    },
    setPluginData(key, value) {
      this.pluginData[key] = value;
    },
    getPluginData(key) {
      return this.pluginData[key] ?? '';
    },
  };
  if (!props.noFills) node.fills = props.fills ?? [];
  return node;
}

export class FakeStorage {
  data = new Map<string, unknown>();
  async getAsync(key: string) {
    return this.data.has(key) ? JSON.parse(JSON.stringify(this.data.get(key))) : undefined;
  }
  async setAsync(key: string, value: unknown) {
    this.data.set(key, value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  }
  async deleteAsync(key: string) {
    this.data.delete(key);
  }
  async keysAsync() {
    return [...this.data.keys()];
  }
}

export function fakeFigma(nodes: FakeNode[] = []) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const images: Array<{ hash: string; bytes: Uint8Array }> = [];
  const notifications: Array<{ message: string; error: boolean }> = [];
  const posted: unknown[] = [];
  const handlers: Record<string, Array<() => void>> = {};
  const opened: string[] = [];
  let undoCommits = 0;
  let scrolledTo: unknown[] = [];

  const page = {
    type: 'PAGE',
    children: [] as FakeNode[],
    selection: [] as FakeNode[],
    appendChild(node: FakeNode) {
      if (!this.children.includes(node)) this.children.push(node);
    },
  };

  const figma = {
    currentPage: page,
    clientStorage: new FakeStorage(),
    viewport: {
      center: { x: 500, y: 300 },
      scrollAndZoomIntoView(list: unknown[]) {
        scrolledTo = list;
      },
    },
    ui: {
      onmessage: undefined as undefined | ((message: unknown) => void),
      postMessage(message: unknown) {
        posted.push(message);
      },
    },
    showUI: (_html: string, options: unknown) => {
      showUIOptions = options;
    },
    createImage(bytes: Uint8Array) {
      if (bytes.length === 0) throw new Error('Image is empty');
      const image = { hash: `hash-${images.length + 1}`, bytes };
      images.push(image);
      return image;
    },
    async getNodeByIdAsync(id: string) {
      return byId.get(id) ?? null;
    },
    createRectangle() {
      const node = fakeNode('RECTANGLE');
      byId.set(node.id, node);
      page.children.push(node);
      return node;
    },
    commitUndo() {
      undoCommits += 1;
    },
    notify(message: string, options?: { error?: boolean }) {
      notifications.push({ message, error: options?.error === true });
    },
    on(event: string, handler: () => void) {
      (handlers[event] ??= []).push(handler);
    },
    openExternal(url: string) {
      opened.push(url);
    },
  };

  let showUIOptions: unknown;

  return {
    figma,
    page,
    images,
    notifications,
    posted,
    opened,
    handlers,
    get undoCommits() {
      return undoCommits;
    },
    get scrolledTo() {
      return scrolledTo;
    },
    get showUIOptions() {
      return showUIOptions;
    },
  };
}
