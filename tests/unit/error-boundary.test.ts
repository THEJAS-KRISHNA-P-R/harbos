import test from 'node:test';
import assert from 'node:assert/strict';
import {
  haveResetKeysChanged,
  normalizeRenderError,
} from '../../src/web/ui/error-boundary-utils';
import { ErrorBoundary } from '../../src/web/ui/ErrorBoundary';

test('normalizeRenderError extracts name, message, and bounded stack preview from Error instances', () => {
  const err = new TypeError("Cannot read properties of null (reading 'map')");
  const result = normalizeRenderError(err);
  assert.equal(result.name, 'TypeError');
  assert.equal(result.message, "Cannot read properties of null (reading 'map')");
  assert.ok(result.stackPreview === null || result.stackPreview.split('\n').length <= 6);
});

test('normalizeRenderError handles strings, plain objects, and unknown thrown values gracefully', () => {
  assert.deepEqual(normalizeRenderError('Network payload corrupted'), {
    name: 'Error',
    message: 'Network payload corrupted',
    stackPreview: null,
  });

  assert.deepEqual(
    normalizeRenderError({ name: 'ContractError', message: 'Missing lots array' }),
    {
      name: 'ContractError',
      message: 'Missing lots array',
      stackPreview: null,
    }
  );

  assert.deepEqual(normalizeRenderError(null), {
    name: 'Error',
    message: 'An unexpected rendering error occurred.',
    stackPreview: null,
  });
});

test('haveResetKeysChanged detects workspace transitions and ignores identical key tuples', () => {
  assert.equal(haveResetKeysChanged(undefined, undefined), false);
  assert.equal(haveResetKeysChanged(['weighing', 'u-1'], ['weighing', 'u-1']), false);
  assert.equal(haveResetKeysChanged(['weighing', 'u-1'], ['pit', 'u-1']), true);
  assert.equal(haveResetKeysChanged(['weighing'], ['weighing', 'u-1']), true);
  assert.equal(haveResetKeysChanged(undefined, ['weighing']), true);
  assert.equal(haveResetKeysChanged([Number.NaN], [Number.NaN]), false);
});

test('ErrorBoundary.getDerivedStateFromError captures thrown errors deterministically', () => {
  const boom = new RangeError('Invalid ledger split');
  const nextState = ErrorBoundary.getDerivedStateFromError(boom);
  assert.equal(nextState.hasError, true);
  assert.equal(nextState.error, boom);
});
