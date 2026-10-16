"""Reads auth emails from the local Mailpit (http://127.0.0.1:54324) so tests can confirm a sign-up. Standard library only."""
import html
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

MAIL = os.environ.get('MAILPIT_URL', 'http://127.0.0.1:54324').rstrip('/')


def _get(path):
    with urllib.request.urlopen(MAIL + path, timeout=10) as res:
        return json.loads(res.read())


def wait_for_link(email, pattern, timeout=20):
    """Returns the first link in the newest email to `email` that matches `pattern` (a regex on the URL)."""
    end = time.time() + timeout
    while time.time() < end:
        found = _get('/api/v1/search?query=' + urllib.parse.quote('to:' + email)).get('messages') or []
        for msg in found:
            body = _get('/api/v1/message/' + msg['ID'])
            text = (body.get('HTML') or '') + ' ' + (body.get('Text') or '')
            for url in re.findall(r'https?://[^\s"\'<>]+', text):
                url = html.unescape(url)
                if re.search(pattern, url):
                    return url
        time.sleep(0.5)
    raise RuntimeError('no email with a matching link for ' + email)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def follow_once(url):
    """Opens a verification link without following the redirect to the (possibly not running) site."""
    try:
        urllib.request.build_opener(_NoRedirect).open(url, timeout=15)
    except urllib.error.HTTPError as e:
        if e.code not in (301, 302, 303, 307, 308):
            raise


def confirm_signup(email):
    follow_once(wait_for_link(email, r'/auth/v1/verify\?.*type=signup'))


def clear():
    req = urllib.request.Request(MAIL + '/api/v1/messages', method='DELETE')
    urllib.request.urlopen(req, timeout=10).read()
