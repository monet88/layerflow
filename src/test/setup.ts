import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

vi.mock('@spectrum-web-components/action-button/sp-action-button.js', () => ({}));
vi.mock('@spectrum-web-components/button/sp-button.js', () => ({}));
vi.mock('@spectrum-web-components/progress-circle/sp-progress-circle.js', () => ({}));
vi.mock('@spectrum-web-components/textfield/sp-textfield.js', () => ({}));
