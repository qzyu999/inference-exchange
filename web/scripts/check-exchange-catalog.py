"""Browser contract test against a running Vite server, with isolated API fixtures.

Check the catalog, IE availability filter, and empty-result recovery.
Run with Playwright installed.
Set IE_BROWSER_EXECUTABLE for an existing Chrome.
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
           dict(id='example/external', name='External model', ie_count=0, offers=[{**external, 'id': 'or/two'}]),
           dict(id='example/reference', name='IE reference model', ie_count=0, offers=[
               {**external, 'id': 'ie/reference', 'provider': 'inference-exchange', 'quote_kind': 'catalog'}])]
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
    # Filter the model list by live IE offers. Retain comparison offers.
    trigger = page.get_by_role('button', name='Search exchange models')
    search = page.get_by_role('combobox', name='Search exchange models')
    provider_filter = page.get_by_role('combobox', name='Filter models by provider')
    trigger.click()
    provider_filter.select_option('ie')
    expect(page.get_by_role('option', name='External model', exact=False)).to_have_count(0)
    expect(page.get_by_role('option', name='IE reference model', exact=False)).to_have_count(0)
    expect(page.get_by_role('option', name='Example model', exact=False)).to_be_visible()
    expect(trigger).to_contain_text('Selected model hidden by filters')
    expect(page.get_by_role('listbox')).to_contain_text('1 IE provider online')
    search.fill('Example model')
    page.keyboard.press('Enter')
    expect(page.get_by_role('heading', name='Example model', exact=True)).to_be_visible()
    expect(page.get_by_role('cell').filter(has_text='Community provider')).to_be_visible()
    expect(page.get_by_role('cell').filter(has_text='Example competitor')).to_be_visible()
    # Combine filters, then recover from an empty list after closing the popup.
    trigger.click()
    page.get_by_text('Proprietary', exact=True).click()
    expect(page.get_by_role('listbox')).to_contain_text('0 models match')
    search.focus()
    page.keyboard.press('Escape')
    expect(provider_filter).to_have_count(0)
    trigger.click()
    expect(provider_filter).to_have_value('ie')
    page.get_by_role('button', name='Clear filters', exact=True).click()
    expect(provider_filter).to_have_value('')
    expect(page.get_by_role('option', name='External model', exact=False)).to_be_visible()
    expect(page.get_by_role('option', name='IE reference model', exact=False)).to_be_visible()
    # Check a narrow screen with the provider filter active.
    page.set_viewport_size({'width': 390, 'height': 844})
    provider_filter.select_option('ie')
    expect(provider_filter).to_be_visible()
    assert provider_filter.evaluate('(el) => el.getBoundingClientRect().right <= window.innerWidth')
    page.screenshot(path=os.environ.get('IE_BROWSER_SCREENSHOT', '/tmp/exchange-mobile.png'), full_page=True)
    # A refreshed catalog with no live offers must allow filter recovery.
    for model in catalog:
        model['offers'] = [offer for offer in model['offers'] if not offer.get('ie')]
        model['ie_count'] = 0
    market.clear()
    expect(page.get_by_role('listbox')).to_contain_text('0 models match', timeout=20000)
    expect(provider_filter).to_be_enabled()
    provider_filter.select_option('')
    expect(page.get_by_role('option', name='External model', exact=False)).to_be_visible()
    assert not errors, errors
    browser.close()
print('Browser catalog: IE availability, comparison offers, empty-result recovery, refresh, and mobile passed')
