import { setGlobalOptions } from 'firebase-functions/v2';
import { REGION, RUNTIME_SERVICE_ACCOUNT } from './config.js';

// Must be evaluated before any module that defines a function: index.ts imports it first.
setGlobalOptions({ region: REGION, maxInstances: 20, serviceAccount: RUNTIME_SERVICE_ACCOUNT });
