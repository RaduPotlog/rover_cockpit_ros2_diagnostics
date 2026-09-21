// Unit tests for the diagnostic value labels (run with `npm test`, Node's type stripping).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { booleanMeaning } from '../../src/diagnostics/valueLabels.ts';

test('the HW E-Stop button reads as PRESSED / RELEASED', () => {
    assert.equal(booleanMeaning('HW E-Stop user button', 'True'), 'PRESSED');
    assert.equal(booleanMeaning('HW E-Stop user button', 'False'), 'RELEASED');
});

test('the SW E-Stop button reads as PRESSED / RELEASED', () => {
    assert.equal(booleanMeaning('SW E-Stop user button', 'True'), 'PRESSED');
    assert.equal(booleanMeaning('SW E-Stop user button', 'False'), 'RELEASED');
});

test('the latch reads as ON / OFF', () => {
    assert.equal(booleanMeaning('SW E-Stop latch status', 'True'), 'ON');
    assert.equal(booleanMeaning('SW E-Stop latch status', 'False'), 'OFF');
});

test('diagnostic_updater spelling and stray case/whitespace are accepted', () => {
    assert.equal(booleanMeaning('HW E-Stop user button', 'true'), 'PRESSED');
    assert.equal(booleanMeaning('HW E-Stop user button', ' FALSE '), 'RELEASED');
});

test('unlabelled keys and non-boolean values get no label rather than a guess', () => {
    assert.equal(booleanMeaning('Locked', 'True'), null);
    assert.equal(booleanMeaning('HW E-Stop user button', '1'), null);
    assert.equal(booleanMeaning('HW E-Stop user button', ''), null);
});
