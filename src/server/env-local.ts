// Import first in local entry points: ES imports are hoisted, so env must be set in its own module.
process.env.DYNAMODB_ENDPOINT ??= 'http://localhost:8000';
