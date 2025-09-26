import './index.css';
import {createRoot} from 'react-dom/client';
import {StrictMode} from 'react';

import App from './components/App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Unable to find root container');
}

const root = createRoot(container);
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);

