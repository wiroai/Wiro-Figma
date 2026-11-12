import { render } from 'preact';
import type { Credentials } from '../shared/messages';
import { App, type Services } from './app';
import { createBridge, figmaChannel } from './bridge';
import { McpClient } from './mcp';
import { WiroApi } from './wiro';
import './styles.css';

let credentials: Credentials | null = null;

const services: Services = {
  bridge: createBridge(figmaChannel()),
  api: new WiroApi(new McpClient(() => credentials)),
  setCredentials: (next) => {
    credentials = next;
  },
};

render(<App services={services} />, document.getElementById('app')!);
