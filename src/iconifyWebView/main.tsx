import './style.css';
import { bootstrap } from 'jinge';

import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Missing Iconify Webview root');
bootstrap(App, root);
