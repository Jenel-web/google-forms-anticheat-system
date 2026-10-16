import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFormId, formLinkIssue } from '../src/shared/constants.js';

const ID = '1FAIpQLSdQ96Buato0RLX7G2BeNhwfEfg8h7wNk2mEq4SIO-JaQX5IBw';

test('the published link is accepted, with or without a query string', () => {
  assert.equal(formLinkIssue(`https://docs.google.com/forms/d/e/${ID}/viewform`), null);
  assert.equal(formLinkIssue(`https://docs.google.com/forms/d/e/${ID}/viewform?usp=publish-editor`), null);
  assert.equal(parseFormId(`https://docs.google.com/forms/d/e/${ID}/viewform?usp=publish-editor`), ID);
});

test('an edit link is rejected as EDIT_LINK', () => {
  assert.equal(formLinkIssue('https://docs.google.com/forms/d/1AbCdEfGh/edit'), 'EDIT_LINK');
  assert.equal(formLinkIssue('https://docs.google.com/forms/d/1AbCdEfGh/edit?usp=sharing'), 'EDIT_LINK');
  assert.equal(formLinkIssue('https://docs.google.com/forms/u/1/d/1AbCdEfGh/edit'), 'EDIT_LINK');
});

test('an editor-ID viewform link is rejected because students never use that ID', () => {
  assert.equal(formLinkIssue('https://docs.google.com/forms/d/1AbCdEfGh/viewform'), 'EDITOR_ID_LINK');
});

test('other input is rejected', () => {
  assert.equal(formLinkIssue(''), 'EMPTY');
  assert.equal(formLinkIssue('   '), 'EMPTY');
  assert.equal(formLinkIssue('not a link'), 'NOT_A_FORM_LINK');
  assert.equal(formLinkIssue('https://example.com/forms/d/e/abc/viewform'), 'NOT_A_FORM_LINK');
  assert.equal(formLinkIssue('https://forms.gle/abc123'), 'NOT_A_FORM_LINK');
  assert.equal(formLinkIssue('https://docs.google.com/forms/d/e/abc/formResponse'), 'NOT_A_FORM_LINK');
});
