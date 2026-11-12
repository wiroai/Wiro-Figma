// A stand-in for the parts of the Figma plugin API that dist/code.js uses,
// drawn as a simple canvas. Image rules follow figma.createImage: PNG, JPEG or
// GIF only, at most 4096 px a side.
//
// Query parameters:
//   theme=dark       Figma's dark theme colors
//   clean=1          hide the hint, the toasts and the balance (screenshots)
//   reset=1          clear the stored preferences, Recent and unfinished runs
//   prefs={json}     seed the preferences
//   recent=url,url   seed the Recent list
//   photo=url        put this image in the "Photo" frame, for the Edit tab

(async () => {
  const params = new URLSearchParams(location.search);
  const dark = params.get('theme') === 'dark';
  if (dark) document.body.classList.add('dark');
  const clean = params.get('clean') === '1';
  if (clean) document.body.classList.add('clean');

  const world = document.getElementById('world');
  const stage = document.getElementById('stage');
  const pluginBody = document.getElementById('plugin-body');
  const toasts = document.getElementById('toasts');

  const LIGHT = {
    '--figma-color-bg': '#ffffff',
    '--figma-color-bg-secondary': '#f5f5f5',
    '--figma-color-bg-hover': '#f5f5f5',
    '--figma-color-text': '#1e1e1e',
    '--figma-color-text-secondary': '#757575',
    '--figma-color-text-tertiary': '#b3b3b3',
    '--figma-color-border': '#e6e6e6',
    '--figma-color-border-strong': '#2c2c2c',
    '--figma-color-border-selected': '#0d99ff',
    '--figma-color-text-danger': '#dc3412',
    '--figma-color-text-success': '#14ae5c',
  };
  const DARK = {
    '--figma-color-bg': '#2c2c2c',
    '--figma-color-bg-secondary': '#383838',
    '--figma-color-bg-hover': '#383838',
    '--figma-color-text': '#ffffff',
    '--figma-color-text-secondary': '#ffffffb2',
    '--figma-color-text-tertiary': '#ffffff66',
    '--figma-color-border': '#444444',
    '--figma-color-border-strong': '#ffffff66',
    '--figma-color-border-selected': '#0c8ce9',
    '--figma-color-text-danger': '#fca397',
    '--figma-color-text-success': '#79d297',
  };

  // ---- Scene ---------------------------------------------------------------

  const nodes = new Map();
  let nextId = 1;
  const handlers = {};
  const emit = (event) => (handlers[event] || []).forEach((handler) => handler());
  const images = new Map();
  const FONT = { family: 'Inter', style: 'Regular' };

  class FakeNode {
    constructor(type, props = {}) {
      this.id = `${nextId++}:1`;
      this.type = type;
      this.name = props.name || type;
      this._x = props.x || 0;
      this._y = props.y || 0;
      this.width = props.width || 100;
      this.height = props.height || 100;
      this.removed = false;
      this.pluginData = {};
      this.children = [];
      this.parent = null;
      this.element = document.createElement('div');
      this.element.className = `node ${type.toLowerCase()}`;
      this.element.addEventListener('click', (event) => {
        event.stopPropagation();
        select(this, event.shiftKey);
      });
      const label = document.createElement('div');
      label.className = 'label';
      this.element.append(label);
      this.content = document.createElement('div');
      this.content.className = 'content';
      this.element.append(this.content);
      nodes.set(this.id, this);
      // Groups have no fills property at all, as in Figma.
      if (type !== 'GROUP') {
        this._fills = props.fills || [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
        Object.defineProperty(this, 'fills', {
          enumerable: true,
          get: () => this._fills,
          set: (value) => {
            this._fills = JSON.parse(JSON.stringify(value));
            this.render();
          },
        });
      }
      if (type === 'TEXT') {
        this._characters = props.characters || '';
        this.fontName = FONT;
        this.fontSize = props.fontSize || 32;
        this.hasMissingFont = false;
        this.textAutoResize = 'NONE';
        this._fills = props.fills || [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 } }];
        Object.defineProperty(this, 'characters', {
          enumerable: true,
          get: () => this._characters,
          set: (value) => {
            this._characters = String(value);
            this.render();
          },
        });
      }
      if (props.parent) props.parent.appendChild(this);
      else world.append(this.element);
      this.render();
    }
    get x() {
      return this._x;
    }
    set x(value) {
      this._x = value;
      if (this.content) this.render();
    }
    get y() {
      return this._y;
    }
    set y(value) {
      this._y = value;
      if (this.content) this.render();
    }
    appendChild(child) {
      child.parent = this;
      this.children.push(child);
      this.element.append(child.element);
    }
    get absoluteBoundingBox() {
      let x = this.x;
      let y = this.y;
      for (let parent = this.parent; parent; parent = parent.parent) {
        x += parent.x;
        y += parent.y;
      }
      return { x, y, width: this.width, height: this.height };
    }
    findAllWithCriteria({ types }) {
      const found = [];
      const walk = (node) => {
        for (const child of node.children) {
          if (types.includes(child.type)) found.push(child);
          walk(child);
        }
      };
      walk(this);
      return found;
    }
    getRangeAllFontNames() {
      return [this.fontName];
    }
    resize(width, height) {
      this.width = width;
      this.height = height;
      this.render();
    }
    rescale(factor) {
      this.resize(this.width * factor, this.height * factor);
    }
    setPluginData(key, value) {
      this.pluginData[key] = value;
    }
    getPluginData(key) {
      return this.pluginData[key] || '';
    }
    async exportAsync(settings) {
      const scale = settings?.constraint?.type === 'SCALE' ? settings.constraint.value : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(this.width * scale));
      canvas.height = Math.max(1, Math.round(this.height * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const paint = (this._fills || [])[0];
      if (paint && paint.type === 'IMAGE') {
        const bitmap = await createImageBitmap(new Blob([images.get(paint.imageHash).bytes]));
        const cover = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
        const w = bitmap.width * cover;
        const h = bitmap.height * cover;
        context.drawImage(bitmap, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      }
      if (this.type === 'TEXT') {
        context.fillStyle = '#1e1e1e';
        context.font = `${this.fontSize * scale}px Inter, sans-serif`;
        context.fillText(this._characters, 4, this.fontSize * scale);
      }
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      return new Uint8Array(await blob.arrayBuffer());
    }
    render() {
      const style = this.element.style;
      style.left = `${this.x}px`;
      style.top = `${this.y}px`;
      style.width = `${this.width}px`;
      style.height = `${this.height}px`;
      this.element.querySelector('.label').textContent = this.parent
        ? ''
        : `${this.name}  ${Math.round(this.width)} × ${Math.round(this.height)}`;
      const paint = (this._fills || [])[0];
      if (this.type === 'TEXT') {
        this.content.textContent = this._characters;
        this.content.style.fontSize = `${this.fontSize}px`;
        style.backgroundImage = '';
        style.background = 'transparent';
        if (paint && paint.type === 'IMAGE') {
          this.content.style.backgroundImage = `url("${images.get(paint.imageHash).url}")`;
          this.content.style.backgroundSize = 'cover';
          this.content.style.webkitBackgroundClip = 'text';
          this.content.style.color = 'transparent';
        }
      } else if (this.svgUrl) {
        style.background = `center / contain no-repeat url("${this.svgUrl}") #ffffff`;
      } else if (paint && paint.type === 'IMAGE') {
        style.backgroundImage = `url("${images.get(paint.imageHash).url}")`;
        style.backgroundSize = paint.scaleMode === 'FIT' ? 'contain' : 'cover';
        style.backgroundColor = paint.scaleMode === 'FIT' ? '#f0f0f0' : '';
      } else {
        style.backgroundImage = '';
      }
      fitWorld();
    }
  }

  let selection = [];
  const page = {
    type: 'PAGE',
    name: 'Page 1',
    get children() {
      return [...nodes.values()].filter((node) => !node.parent);
    },
    get selection() {
      return selection;
    },
    set selection(list) {
      selection = [...list];
      for (const node of nodes.values()) node.element.classList.toggle('selected', selection.includes(node));
      emit('selectionchange');
    },
    appendChild(node) {
      if (!node.parent) world.append(node.element);
    },
  };

  function select(node, add) {
    if (!node) page.selection = [];
    else if (add)
      page.selection = selection.includes(node) ? selection.filter((n) => n !== node) : [...selection, node];
    else page.selection = [node];
  }
  stage.addEventListener('click', () => select(null));

  function fitWorld() {
    let right = 0;
    let bottom = 0;
    for (const node of nodes.values()) {
      if (node.parent) continue;
      right = Math.max(right, node.x + node.width);
      bottom = Math.max(bottom, node.y + node.height);
    }
    const available = stage.clientWidth - 80;
    const scale = Math.min(0.32, available / Math.max(right, 1));
    world.style.transform = `scale(${scale})`;
    world.style.setProperty('--inverse', String(1 / scale));
    world.style.width = `${right}px`;
    world.style.height = `${bottom + 200}px`;
  }
  window.addEventListener('resize', fitWorld);

  new FakeNode('FRAME', { name: 'Hero', x: 0, y: 0, width: 1440, height: 810 });
  new FakeNode('FRAME', { name: 'Post', x: 1560, y: 0, width: 1080, height: 1350 });
  new FakeNode('ELLIPSE', { name: 'Avatar', x: 2760, y: 0, width: 480, height: 480 });
  const photo = new FakeNode('FRAME', { name: 'Photo', x: 0, y: 960, width: 800, height: 800 });
  const card = new FakeNode('FRAME', { name: 'Card', x: 960, y: 1500, width: 1200, height: 420 });
  new FakeNode('TEXT', {
    name: 'Title',
    parent: card,
    x: 40,
    y: 40,
    width: 1100,
    height: 80,
    characters: 'Plan your next trip in minutes',
    fontSize: 56,
  });
  new FakeNode('TEXT', {
    name: 'Body',
    parent: card,
    x: 40,
    y: 160,
    width: 1100,
    height: 200,
    characters: 'Pick a city, set your dates and get a day by day plan with places to eat, see and stay.',
    fontSize: 32,
  });
  if (!clean) new FakeNode('GROUP', { name: 'Logo group', x: 2760, y: 620, width: 480, height: 200 });

  // ---- Images --------------------------------------------------------------

  function imageInfo(bytes) {
    const b = bytes;
    const u32 = (i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      return { type: 'image/png', width: u32(16), height: u32(20) };
    }
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
      return { type: 'image/gif', width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) break;
        const marker = b[i + 1];
        const length = (b[i + 2] << 8) | b[i + 3];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { type: 'image/jpeg', height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
        }
        i += 2 + length;
      }
      return { type: 'image/jpeg', width: 0, height: 0 };
    }
    return null;
  }

  function addImage(bytes) {
    const info = imageInfo(bytes);
    if (!info) throw new Error('Image type is unsupported');
    if (info.width > 4096 || info.height > 4096) throw new Error('Image is too large');
    const hash = `hash-${images.size + 1}`;
    images.set(hash, { url: URL.createObjectURL(new Blob([bytes], { type: info.type })), ...info, bytes });
    return hash;
  }

  // ---- Plugin API ------------------------------------------------------------

  // Client storage survives a reload (like Figma's), in this page's
  // localStorage. The API key stays in memory only and comes from the server.
  if (params.get('reset') === '1') {
    Object.keys(localStorage)
      .filter((key) => key.startsWith('harness:'))
      .forEach((key) => localStorage.removeItem(key));
  }
  const memory = new Map();
  const storage = {
    has: (key) => (key === 'credentials' ? memory.has(key) : localStorage.getItem(`harness:${key}`) !== null),
    get: (key) => (key === 'credentials' ? memory.get(key) : JSON.parse(localStorage.getItem(`harness:${key}`))),
    set: (key, value) =>
      key === 'credentials' ? memory.set(key, value) : localStorage.setItem(`harness:${key}`, JSON.stringify(value)),
    delete: (key) => (key === 'credentials' ? memory.delete(key) : localStorage.removeItem(`harness:${key}`)),
    keys: () => [
      ...memory.keys(),
      ...Object.keys(localStorage)
        .filter((key) => key.startsWith('harness:'))
        .map((key) => key.slice(8)),
    ],
  };
  const credentials = await fetch('/credentials.json').then((response) => response.json());
  if (credentials) storage.set('credentials', credentials);
  if (params.get('prefs')) storage.set('preferences', JSON.parse(params.get('prefs')));
  const seeded = (params.get('recent') || '').split(',').filter((url) => url.startsWith('https://'));
  if (seeded.length > 0) {
    storage.set(
      'recent',
      seeded.map((url, index) => ({
        url,
        kind: /\.svg(\?|$)/.test(url) ? 'svg' : undefined,
        model: 'seeded/image',
        prompt: `Seeded image ${index + 1}`,
        createdAt: Date.now(),
      })),
    );
  }
  const photoUrl = params.get('photo');
  if (photoUrl) {
    const bytes = new Uint8Array(await (await fetch(photoUrl)).arrayBuffer());
    photo.fills = [{ type: 'IMAGE', imageHash: addImage(bytes), scaleMode: 'FILL' }];
  }
  const manifest = await fetch('/manifest.json').then((response) => response.json());

  let iframe;

  function toast(message, error) {
    const element = document.createElement('div');
    element.className = `toast${error ? ' error' : ''}`;
    element.textContent = message;
    toasts.append(element);
    setTimeout(() => element.remove(), 4000);
  }

  window.figma = {
    mixed: Symbol('mixed'),
    currentPage: page,
    clientStorage: {
      async getAsync(key) {
        return storage.has(key) ? structuredClone(storage.get(key)) : undefined;
      },
      async setAsync(key, value) {
        storage.set(key, structuredClone(value));
      },
      async deleteAsync(key) {
        storage.delete(key);
      },
      async keysAsync() {
        return storage.keys();
      },
    },
    viewport: {
      get center() {
        return { x: 1600, y: 2400 };
      },
      scrollAndZoomIntoView(list) {
        list[0]?.element.scrollIntoView({ block: 'center', inline: 'center' });
      },
    },
    ui: {
      onmessage: undefined,
      postMessage(message) {
        iframe.contentWindow.postMessage({ pluginMessage: message }, '*');
      },
    },
    showUI(html, options) {
      const domains = manifest.networkAccess.allowedDomains.join(' ');
      const csp = [
        "default-src 'none'",
        "script-src 'unsafe-inline'",
        "style-src 'unsafe-inline'",
        `img-src ${domains} data: blob:`,
        `connect-src ${domains}`,
      ].join('; ');
      const vars = Object.entries(dark ? DARK : LIGHT)
        .map(([name, value]) => `${name}: ${value};`)
        .join(' ');
      const extra = clean ? '.balance { display: none !important; }' : '';
      const head = `<meta http-equiv="Content-Security-Policy" content="${csp}"><style>:root { ${vars} } ${extra}</style>`;
      iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.width = String(options.width);
      iframe.height = String(options.height);
      iframe.title = 'Wiro AI plugin';
      iframe.srcdoc = html
        .replace('<head>', `<head>${head}`)
        .replace('<html', `<html class="${dark ? 'figma-dark' : 'figma-light'}"`);
      pluginBody.append(iframe);
      document.getElementById('plugin-title').textContent = options.title || manifest.name;
      requestAnimationFrame(fitWorld);
    },
    createImage(bytes) {
      return { hash: addImage(bytes) };
    },
    getImageByHash(hash) {
      const image = images.get(hash);
      if (!image) return null;
      return {
        hash,
        getBytesAsync: async () => image.bytes,
        getSizeAsync: async () => ({ width: image.width, height: image.height }),
      };
    },
    async getNodeByIdAsync(id) {
      return nodes.get(id) || null;
    },
    createRectangle() {
      return new FakeNode('RECTANGLE', { width: 100, height: 100 });
    },
    createText() {
      return new FakeNode('TEXT', { width: 400, height: 40, fontSize: 16 });
    },
    createNodeFromSvg(svg) {
      if (!/<svg[\s>]/i.test(svg)) throw new Error('Invalid SVG');
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const root = doc.documentElement;
      const box = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
      const width = Number.parseFloat(root.getAttribute('width')) || box[2] || 512;
      const height = Number.parseFloat(root.getAttribute('height')) || box[3] || 512;
      const node = new FakeNode('FRAME', { name: 'svg', width, height });
      node.svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      node.svgLength = svg.length;
      node.render();
      return node;
    },
    async loadFontAsync() {},
    commitUndo() {},
    notify(message, options) {
      toast(message, options && options.error);
    },
    on(event, handler) {
      (handlers[event] = handlers[event] || []).push(handler);
    },
    openExternal(url) {
      toast(`Opens ${url}`);
    },
  };

  window.addEventListener('message', (event) => {
    if (!iframe || event.source !== iframe.contentWindow) return;
    const message = event.data && event.data.pluginMessage;
    if (message && window.figma.ui.onmessage) window.figma.ui.onmessage(message);
  });

  function imageSummary(node) {
    const paint = node.fills && node.fills[0];
    if (!paint || paint.type !== 'IMAGE') return null;
    const image = images.get(paint.imageHash);
    return { type: image.type, width: image.width, height: image.height, bytes: image.bytes.length };
  }

  // For checks from the browser console or automation.
  window.harness = {
    select(names) {
      page.selection = [...nodes.values()].filter((node) => names.includes(node.name));
    },
    scene() {
      return [...nodes.values()].map((node) => ({
        id: node.id,
        type: node.type,
        name: node.name,
        parent: node.parent ? node.parent.name : null,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        characters: node.type === 'TEXT' ? node.characters : undefined,
        fills: node.fills,
        svg: node.svgLength || 0,
        image: imageSummary(node),
        pluginData: node.pluginData,
      }));
    },
    storageKeys: () => storage.keys(),
  };

  window.__html__ = await fetch('/dist/ui.html').then((response) => response.text());
  const script = document.createElement('script');
  script.src = '/dist/code.js';
  document.body.append(script);
})();
