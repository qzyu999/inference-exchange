"""Browser contract test against a running Vite server, with isolated API fixtures.

Checks that the Exchange page keeps its original layout and lists published
catalog models (#269). Run with playwright installed. Set IE_BROWSER_EXECUTABLE
for an existing Chrome.
"""
import os
import time
from urllib.parse import urlparse
from urllib.request import urlopen

from playwright.sync_api import sync_playwright, expect

now = int(time.time())
ie = dict(id='ie/p1/example-model', provider='Community provider', route='Inference Exchange', ie=True,
          input='0.05', cache_read='0.01', output='0.15', observed_at=now,
          quantization='FP16', context_length=4096, trust='open', source_url='/keys')
external = dict(id='or/one', provider='Example competitor', route='OpenRouter',
                input='0.2', cache_read='0.05', output='0.6', observed_at=now,
                quantization='FP16', context_length=4096, source_url='https://openrouter.ai/example/model')
catalog = [dict(id='example/model', name='Example model', ie_count=1, offers=[ie, external]),
           dict(id='example/external', name='External model', ie_count=0, offers=[{**external, 'id': 'or/two'}])]
market = [dict(model='Example model', family='Example', size='8B', canonical_id='example-8b-instruct',
               provider_count=1, cheapest_output=0.15, fastest_tps=0, max_trust='open',
               capabilities=dict(context_length=4096, supports_vision=False, supports_tool_calling=False,
                                 architecture='', model_type=''),
               providers=[dict(id='p1', name='Community provider', price_output=0.15, price_input=0.05,
                               price_cache=0.01, tps=0, trust='open', hardware='', quantization='FP16',
                               load=0, encrypted=False, verified=False, slots='0/1', context_length=4096,
                               format='', original_model='example-model')],
               reference_prices=[])]


def handler(route):
    path = urlparse(route.request.url).path
    if path.endswith('/exchange/catalog'):
        data = dict(models=catalog, total=len(catalog), generation=1, generated_at=now, sync_error=None)
    elif path.endswith('/exchange/market'):
        data = dict(models=market, total_providers=1, total_models=1)
    elif path.endswith('/exchange/stats'):
        data = dict(providers_online=1, models_available=1, total_requests=0)
    elif path.endswith('/auth/me'):
        route.fulfill(status=401, json={'detail': 'not signed in'}); return
    elif path.endswith('/health'):
        data = dict(status='ok', providers=1, models=['example-model'])
    else:
        data = {}
    route.fulfill(json=data)


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
                                args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1100})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/v1/**', handler)
    page.route('**/health**', handler)
    page.goto(base_url)
    # Original layout: live strip, depth of market, and recent fills remain.
    expect(page.get_by_text('Depth of market', exact=False)).to_be_visible()
    # Exact match: the empty state "No recent fills" also contains this text.
    expect(page.get_by_text('Recent fills', exact=True)).to_be_visible()
    # The IE model joins its catalog competitor through the exact IE offer ID.
    expect(page.get_by_role('heading', name='Example model', exact=True)).to_be_visible()
    expect(page.get_by_role('cell').filter(has_text='Example competitor')).to_be_visible()
    # A catalog-only model is searchable and selectable.
    page.get_by_role('button', name='Search exchange models').click()
    page.get_by_role('combobox', name='Search exchange models').fill('External model')
    page.keyboard.press('Enter')
    expect(page.get_by_role('heading', name='External model', exact=True)).to_be_visible()
    expect(page.get_by_role('cell').filter(has_text='Example competitor')).to_be_visible()
    page.screenshot(path=os.environ.get('IE_BROWSER_SCREENSHOT', '/tmp/exchange-desktop.png'), full_page=True)
    assert not errors, errors
    browser.close()
print('Browser catalog: original layout, exact IE join, catalog-only model selection passed')
