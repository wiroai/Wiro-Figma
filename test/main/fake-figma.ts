// A small stand-in for the Figma plugin API: just enough of the scene graph,
// images, text, storage and the UI channel for the main thread's tests.

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
  characters?: string;
  fontName?: unknown;
  hasMissingFont?: boolean;
  children: FakeNode[];
  parent?: FakeNode;
  pluginData: Record<string, string>;
  readonly absoluteBoundingBox: { x: number; y: number; width: number; height: number };
  resize(width: number, height: number): void;
  rescale(factor: number): void;
  setPluginData(key: string, value: string): void;
  getPluginData(key: string): string;
  exportAsync(settings?: { constraint?: { type: string; value: number } }): Promise<Uint8Array>;
  findAllWithCriteria?(criteria: { types: string[] }): FakeNode[];
  getRangeAllFontNames?(start: number, end: number): unknown[];
  appendChild?(child: FakeNode): void;
}

let counter = 0;

export interface NodeProps extends Partial<Omit<FakeNode, 'absoluteBoundingBox'>> {
  noFills?: boolean;
  fonts?: unknown[];
}

export function fakeNode(type: string, props: NodeProps = {}): FakeNode {
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
    children: [],
    pluginData: {},
    get absoluteBoundingBox() {
      let x = this.x;
      let y = this.y;
      for (let parent = this.parent; parent; parent = parent.parent) {
        x += parent.x;
        y += parent.y;
      }
      return { x, y, width: this.width, height: this.height };
    },
    resize(width, height) {
      this.width = width;
      this.height = height;
    },
    rescale(factor) {
      this.width *= factor;
      this.height *= factor;
    },
    setPluginData(key, value) {
      this.pluginData[key] = value;
    },
    getPluginData(key) {
      return this.pluginData[key] ?? '';
    },
    async exportAsync(settings) {
      const scale = settings?.constraint?.value ?? 1;
      return new Uint8Array([0x89, 0x50, 0x4e, 0x47, Math.round(this.width * scale) % 256]);
    },
  };
  if (!props.noFills) node.fills = props.fills ?? [];
  if (type === 'TEXT') {
    node.characters = props.characters ?? '';
    node.fontName = props.fontName ?? { family: 'Inter', style: 'Regular' };
    node.hasMissingFont = props.hasMissingFont ?? false;
    const fonts = props.fonts;
    node.getRangeAllFontNames = () => fonts ?? [node.fontName];
  }
  if (['FRAME', 'GROUP', 'COMPONENT', 'SECTION'].includes(type)) {
    node.appendChild = (child) => {
      child.parent = node;
      node.children.push(child);
    };
    node.findAllWithCriteria = ({ types }) => {
      const found: FakeNode[] = [];
      const walk = (parent: FakeNode) => {
        for (const child of parent.children) {
          if (types.includes(child.type)) found.push(child);
          walk(child);
        }
      };
      walk(node);
      return found;
    };
  }
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
  const byId = new Map<string, FakeNode>();
  const register = (node: FakeNode) => {
    byId.set(node.id, node);
    node.children.forEach(register);
  };
  nodes.forEach(register);
  const images: Array<{ hash: string; bytes: Uint8Array; width: number; height: number }> = [];
  const notifications: Array<{ message: string; error: boolean }> = [];
  const posted: unknown[] = [];
  const handlers: Record<string, Array<() => void>> = {};
  const opened: string[] = [];
  const loadedFonts: unknown[] = [];
  let undoCommits = 0;
  let scrolledTo: unknown[] = [];
  let showUIOptions: unknown;

  const page = {
    type: 'PAGE',
    children: nodes.filter((node) => !node.parent),
    selection: [] as FakeNode[],
    appendChild(node: FakeNode) {
      if (!this.children.includes(node)) this.children.push(node);
    },
  };

  const figma = {
    mixed: Symbol('mixed'),
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
      const image = { hash: `hash-${images.length + 1}`, bytes, width: 640, height: 480 };
      images.push(image);
      return image;
    },
    getImageByHash(hash: string) {
      const image = images.find((item) => item.hash === hash);
      if (!image) return null;
      return {
        hash,
        getBytesAsync: async () => image.bytes,
        getSizeAsync: async () => ({ width: image.width, height: image.height }),
      };
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
    createText() {
      const node = fakeNode('TEXT', { width: 100, height: 20 });
      byId.set(node.id, node);
      page.children.push(node);
      return node;
    },
    createNodeFromSvg(svg: string) {
      if (!svg.includes('<svg')) throw new Error('Invalid SVG');
      const size = /width="(\d+)"/.exec(svg);
      const node = fakeNode('FRAME', { width: size ? Number(size[1]) : 1024, height: size ? Number(size[1]) : 1024 });
      byId.set(node.id, node);
      page.children.push(node);
      return node;
    },
    async loadFontAsync(font: unknown) {
      loadedFonts.push(font);
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

  return {
    figma,
    page,
    images,
    notifications,
    posted,
    opened,
    handlers,
    loadedFonts,
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
