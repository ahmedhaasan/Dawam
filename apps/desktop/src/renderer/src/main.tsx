import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';
import './i18n';
import './styles.css';
import './styles/workforce.css';
import './styles/import.css';
import './styles/attendance.css';
import './styles/payroll.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
