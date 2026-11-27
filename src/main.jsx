import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App.jsx';

// The OSD window is transparent: mark the root before first paint so no dark
// canvas (color-scheme) is ever drawn over the video.
if (location.hash.startsWith('#osd')) document.documentElement.classList.add('osd-root');

createRoot(document.getElementById('root')).render(<App />);
