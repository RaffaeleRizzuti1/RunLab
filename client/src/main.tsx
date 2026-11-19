import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = document.getElementById('root');
if (!root) {
  throw new Error('RunLab mount element is missing');
}

createRoot(root).render(<App />);
