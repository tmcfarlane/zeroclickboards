import assert from 'node:assert/strict';
import test from 'node:test';
import { callbackKinds, isOAuthCallbackUri, oauthCallbackMatches } from '../dist/oauth-callback.js';

test('guided client setup capabilities come from supported callbacks only', () => {
  assert.deepEqual(callbackKinds(['http://127.0.0.1/callback']), ['native']);
  assert.deepEqual(callbackKinds(['http://127.0.0.1:4321/callback']), ['native']);
  assert.deepEqual(callbackKinds(['https://chatgpt.com/connector_platform_oauth_redirect']), ['chatgpt']);
  assert.deepEqual(callbackKinds(['https://chatgpt.com/connector/oauth/saved-client_1']), []);
  assert.deepEqual(callbackKinds(['http://127.0.0.1/callback', 'https://chatgpt.com/connector_platform_oauth_redirect']), ['native', 'chatgpt']);
  for (const uri of ['http://127.0.0.1/custom', 'http://127.0.0.1/callback?custom=1', 'http://localhost/callback',
    'https://chatgpt.com.evil.test/connector_platform_oauth_redirect', 'https://chatgpt.com/other',
    'https://chatgpt.com/connector_platform_oauth_redirect?custom=1', 'https://user@chatgpt.com/connector_platform_oauth_redirect']) {
    assert.deepEqual(callbackKinds([uri]), [], uri);
  }
});

test('callback policy varies only a literal native HTTP listener port', () => {
  const registration = 'http://127.0.0.1/callback?native=fixture';
  for (const port of [1024, 54321, 65535]) {
    assert.equal(oauthCallbackMatches(`http://127.0.0.1:${port}/callback?native=fixture`, registration), true);
  }
  assert.equal(oauthCallbackMatches('http://127.0.0.1:54321/callback?native=other', registration), false);
  assert.equal(oauthCallbackMatches('http://127.0.0.1:54321/other?native=fixture', registration), false);
  assert.equal(oauthCallbackMatches('http://127.0.0.1:54321/callback?native=%66ixture', registration), false);
  assert.equal(oauthCallbackMatches('https://127.0.0.1:54321/callback', 'https://127.0.0.1/callback'), false);
  assert.equal(oauthCallbackMatches('https://client.test:54321/callback', 'https://client.test/callback'), false);
  assert.equal(oauthCallbackMatches('https://client.test/callback?native=fixture', 'https://client.test/callback?native=fixture'), true);
  assert.equal(oauthCallbackMatches('https://CLIENT.test/callback', 'https://client.test/callback'), false);
});

test('callback policy rejects unapproved HTTP hosts, parser aliases and hidden URL components', () => {
  for (const value of [
    'http://localhost/callback', 'http://[::1]/callback', 'http://127.0.0.2/callback', 'http://evil.test/callback',
    'http://127.1/callback', 'http://2130706433/callback', 'http://0x7f000001/callback', 'http://0177.0.0.1/callback',
    'http://127.0.0.1.evil.test/callback', 'http://user:pass@127.0.0.1:54321/callback', 'http://@127.0.0.1/callback',
    'http://127.0.0.1:54321/callback#fragment', 'http://127.0.0.1:54321/callback#',
    'http://127.0.0.1:0/callback', 'http://127.0.0.1:65536/callback', 'http://127.0.0.1:00080/callback',
    'http://127.0.0.1/other/../callback', 'http://127.0.0.1/other\\..\\callback',
    ' http://127.0.0.1/callback', 'http://127.0.0.1/callback\t', 'http://127.0.0.1/callback?',
    'https://user:pass@client.test/callback', 'https://@client.test/callback', 'https://client.test/callback#',
    'javascript:alert(1)', null, undefined, ['http://127.0.0.1/callback'],
  ]) {
    assert.equal(isOAuthCallbackUri(value), false, String(value));
    assert.equal(oauthCallbackMatches(value, 'http://127.0.0.1/callback'), false, String(value));
  }
});
