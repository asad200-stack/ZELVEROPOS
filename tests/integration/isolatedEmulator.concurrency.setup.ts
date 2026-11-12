/**
 * Runs before Concurrency suite modules load. Fail closed when isolated mode is on.
 * Concurrency does not start Storage, so storage is not required here.
 */
import { assertIsolatedEmulatorSafety, printIsolatedEndpoints } from './emulatorSafety';

const endpoints = assertIsolatedEmulatorSafety(process.env, { requireStorage: false, requireHub: true });
if (endpoints) printIsolatedEndpoints(endpoints);
