/**
 * Runs before Integration suite modules load. Fail closed when isolated mode is on.
 */
import { assertIsolatedEmulatorSafety, printIsolatedEndpoints } from './emulatorSafety';

const endpoints = assertIsolatedEmulatorSafety(process.env, { requireStorage: true, requireHub: true });
if (endpoints) printIsolatedEndpoints(endpoints);
