import { describe, it, expect } from 'vitest';
import { asksForIdentity } from './identity-probe.js';

/**
 * The never-asks check is the deterministic half of a hard-fail metric, so
 * its own behaviour matters more than most. It scans what the agent said for
 * requests for information it already had.
 */
describe('asksForIdentity', () => {
  it.each([
    ['name', "Sorry, what's your name?"],
    ['name', 'Could I take your full name please?'],
    ['email', 'What email address should I use for the ticket?'],
    ['department', 'And which department are you in?'],
    ['department', 'What team do you work for?'],
    ['location', 'Which office are you calling from?'],
    ['location', 'What floor are you on?'],
    ['employee_id', 'Do you have your employee ID handy?'],
    ['phone', 'What is the best phone number to reach you on?'],
  ])('flags a request for %s', (field, text) => {
    expect(asksForIdentity(text)).toContain(field);
  });

  it('does not flag the agent using a name it already knows', () => {
    expect(asksForIdentity("Hi Priya, what's going on with the laptop?")).toEqual([]);
  });

  /** Confirming a detail back is explicitly allowed; asking for it is not. */
  it('does not flag confirming a known detail', () => {
    expect(asksForIdentity('I have you as Priya Raman in Finance at Toronto HQ.')).toEqual([]);
  });

  it('does not flag an unrelated question', () => {
    expect(asksForIdentity('Is that on your ThinkPad or your iPhone?')).toEqual([]);
  });

  it('does not flag asking which device, which is not an identity field', () => {
    expect(asksForIdentity('Which device is it happening on?')).toEqual([]);
  });

  it('only reports fields that were actually asked for', () => {
    expect(asksForIdentity('What department are you in?')).toEqual(['department']);
  });
});
