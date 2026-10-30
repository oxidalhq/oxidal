import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// The master level reads unit state over its own request; views that embed it
// are tested without it. MasterLevel.test.tsx covers the real component.
vi.mock('./MasterLevel', () => ({ MasterLevel: () => null }));
