import { createRoot } from 'react-dom/client';
import '@design/tokens.css';
import '@design/components/bundle.css';
import './dashboard.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);
