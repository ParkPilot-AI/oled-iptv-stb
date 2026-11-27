// ONYX brand marks. Drawn as CSS masks so they take the current text colour.
import wordmark from '../assets/onyx-wordmark.png';
import mark from '../assets/onyx-mark.png';

export function Wordmark({ className = '', height = '2rem' }) {
  return <span role="img" aria-label="ONYX" className={`logo logo-word ${className}`} style={{ height, '--logo': `url(${wordmark})` }} />;
}

export function Mark({ className = '', height = '1.4rem' }) {
  return <span role="img" aria-label="ONYX" className={`logo logo-mark ${className}`} style={{ height, '--logo': `url(${mark})` }} />;
}
