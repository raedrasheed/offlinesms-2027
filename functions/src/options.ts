// Global runtime options for all functions.
//
// Imported FIRST in index.ts so setGlobalOptions runs before any function
// module is evaluated — otherwise onCall/onRequest capture the defaults at
// definition time and the cap is silently ignored. Keeping maxInstances
// bounded keeps the project under its regional Cloud Run CPU quota and
// caps worst-case cost.
import { setGlobalOptions } from 'firebase-functions/v2';

setGlobalOptions({ maxInstances: 10 });
