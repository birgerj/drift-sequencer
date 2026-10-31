import { App } from './ui/app';

const root = document.getElementById('app');
if (root) void new App(root).init();
