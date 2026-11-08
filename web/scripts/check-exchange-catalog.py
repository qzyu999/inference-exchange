"""Browser contract test against a running Vite server, with isolated API fixtures.

Run with playwright installed. Set IE_BROWSER_EXECUTABLE for an existing Chrome.
"""
import os
import time
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright, expect

now = int(time.time())
ie = dict(id='ie/one',provider='Community provider',route='Inference Exchange',ie=True,
          input='0.05',cache_read='0.01',output='0.15',observed_at=now,
          quantization='FP16',context_length=4096,trust='open',source_url='/keys')
external = dict(id='or/one',provider='Example competitor',route='OpenRouter',
          input='0.2',cache_read='0.05',output='0.6',observed_at=now,
          quantization='FP16',context_length=4096,source_url='https://openrouter.ai/example/model',comparable=True)
models = [dict(id='example/model',name='Example model',ie_count=1,offers=[ie,external]),
          dict(id='example/external',name='External model',ie_count=0,offers=[{**external,'id':'or/two'}])]
requests = []


def handler(route):
    url = urlparse(route.request.url)
    query = parse_qs(url.query)
    if url.path.endswith('/catalog/history'):
        data = {'offers':[dict(id='or/one',name='Example competitor',points=[
            dict(at=now-86400,input='0.2',cache_read='0.05',output='0.6'),
            dict(at=now,input='0.2',cache_read='0.05',output='0.6')]) ]}
    elif url.path.endswith('/catalog'):
        requests.append(query)
        selected = [m for m in models if query.get('ie_only') != ['true'] or m['ie_count']]
        text = query.get('q',[''])[0].lower()
        selected = [m for m in selected if text in m['name'].lower()]
        data = dict(models=selected,total=len(selected),generation=1,generated_at=now,sync_error=None)
    elif url.path.endswith('/auth/me'):
        route.fulfill(status=401,json={'detail':'not signed in'}); return
    elif url.path.endswith('/health'):
        data = dict(status='ok',providers=1,models=['Example model'])
    else:
        data = {}
    route.fulfill(json=data)


from urllib.request import urlopen
base_url = os.environ.get('IE_BROWSER_URL', 'http://127.0.0.1:3000/exchange')
for attempt in range(50):
    try:
        urlopen(base_url, timeout=1).close()
        break
    except OSError:
        time.sleep(0.2)
else:
    raise RuntimeError('Vite server did not become ready')

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('IE_BROWSER_EXECUTABLE'),
                                args=['--no-sandbox','--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width':1440,'height':1100})
    errors = []
    page.on('pageerror',lambda error: errors.append(str(error)))
    page.route('**/v1/**',handler)
    page.route('**/health**',handler)
    page.goto(os.environ.get('IE_BROWSER_URL','http://127.0.0.1:3000/exchange'))
    expect(page.get_by_role('heading',name='Example model',exact=True)).to_be_visible()
    expect(page.get_by_text('75% lower',exact=True)).to_have_count(2)
    expect(page.get_by_text('80% lower',exact=True)).to_be_visible()
    page.get_by_role('button',name='Available on Inference Exchange',exact=True).click()
    expect(page.get_by_text('1 matching models',exact=True)).to_be_visible()
    expect(page.get_by_role('cell').filter(has_text='Example competitor')).to_be_visible()
    assert any(q.get('ie_only') == ['true'] for q in requests)
    page.get_by_role('button',name='Choose a model from these results').click()
    page.keyboard.press('ArrowDown'); page.keyboard.press('Enter')
    page.get_by_role('textbox',name='Search all models').fill('no-such-model')
    expect(page.get_by_text('0 matching models',exact=True)).to_be_visible()
    page.get_by_role('button',name='Clear filters',exact=True).click()
    expect(page.get_by_text('2 matching models',exact=True)).to_be_visible()
    expect(page.get_by_role('img',name='output observed prices')).to_be_visible()
    page.screenshot(path=os.environ.get('IE_BROWSER_SCREENSHOT','/tmp/exchange-desktop.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    expect(page.get_by_role('button',name='Available on Inference Exchange',exact=True)).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Page overflows mobile viewport'
    page.screenshot(path='/tmp/exchange-mobile.png',full_page=True)
    assert not errors, errors
    browser.close()
print('Browser catalog: savings, IE filter, competitor retention, keyboard, empty recovery, history, mobile passed')
