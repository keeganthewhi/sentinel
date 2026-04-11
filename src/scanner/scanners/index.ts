export * from './trivy.scanner.js';
export * from './semgrep.scanner.js';
export * from './trufflehog.scanner.js';
export * from './subfinder.scanner.js';
export * from './httpx.scanner.js';
export * from './fingerprint.helper.js';

import { HttpxScanner } from './httpx.scanner.js';
import { SemgrepScanner } from './semgrep.scanner.js';
import { SubfinderScanner } from './subfinder.scanner.js';
import { TrivyScanner } from './trivy.scanner.js';
import { TruffleHogScanner } from './trufflehog.scanner.js';
import type { BaseScanner } from '../types/scanner.interface.js';

/**
 * Instantiated Phase-1 scanners in canonical registration order.
 * ScannerModule iterates this list in `onModuleInit` to register them.
 */
export const PHASE1_SCANNERS: readonly BaseScanner[] = [
  new TrivyScanner(),
  new SemgrepScanner(),
  new TruffleHogScanner(),
  new SubfinderScanner(),
  new HttpxScanner(),
];
